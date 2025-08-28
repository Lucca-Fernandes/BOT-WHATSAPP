require('dotenv').config();
if (!process.env.DATABASE_URL) {
    console.error('Erro: DATABASE_URL não foi carregado do .env. Verifique o arquivo .env e a instalação do dotenv.');
    process.exit(1);
}
console.log('DATABASE_URL from .env:', process.env.DATABASE_URL);
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const {
    makeWASocket,
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const qrcode = require('qrcode');
const { fetchEnrolled } = require('./services/api');
const P = require('pino');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
    origin: [process.env.FRONTEND_URL || 'http://localhost:3000', 'http://localhost:5173'],
    credentials: true,
}));
app.use(express.json());

let botRunning = false;
let wssClients = [];
let sock = null;
let isRunning = false;
let stopSignal = null;
let contactLogs = [];
const sessions = new Map();
let retryCount = 0;
const maxRetries = 3;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:123@localhost:5432/bot_progress',
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
});

pool.connect((err) => {
    if (err) {
        console.error('Erro ao conectar ao PostgreSQL:', err.stack);
        console.error('Tentativa de conexão:', process.env.DATABASE_URL);
        process.exit(1);
    } else {
        console.log('Conectado ao PostgreSQL');
        pool.query(`
            CREATE TABLE IF NOT EXISTS sent_messages (
                id SERIAL PRIMARY KEY,
                registration_code TEXT NOT NULL,
                monitoring_day TEXT NOT NULL,
                sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (registration_code, monitoring_day)
            );
            CREATE TABLE IF NOT EXISTS stats (
                day TEXT PRIMARY KEY,
                total_sent INTEGER DEFAULT 0,
                agents JSONB DEFAULT '{}'
            );
            CREATE TABLE IF NOT EXISTS auth_state (
                key TEXT PRIMARY KEY,
                value JSONB
            );
        `, (err) => {
            if (err) console.error('Erro ao criar tabelas:', err.stack);
        });
    }
});

const server = app.listen(port, () => {
    console.log(`Backend rodando na porta ${port}`);
    initializeContactLogs().catch(err => {
        console.error('Erro ao inicializar contatos:', err);
        sendLog(`⚠️ Erro ao inicializar contatos: ${err.message}`);
    });
});

const wss = new WebSocketServer({ server, clientTracking: true, maxPayload: 4096 });

const diasSemana = ['segunda', 'terça', 'quarta', 'quinta', 'sexta'];

const generateSessionKey = () => {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
};

const authenticateSession = (req, res, next) => {
    const sessionKey = req.headers['x-session-key'];
    if (!sessionKey || !sessions.has(sessionKey)) {
        return res.status(401).json({ message: 'Não autorizado' });
    }
    req.sessionKey = sessionKey;
    next();
};

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const validUsername = process.env.ADMIN_USERNAME || 'admin';
    const validPassword = process.env.ADMIN_PASSWORD || '123456';

    if (username !== validUsername || password !== validPassword) {
        return res.status(401).json({ message: 'Usuário ou senha incorretos' });
    }

    const sessionKey = generateSessionKey();
    sessions.set(sessionKey, { username });
    res.json({ sessionKey });
});

app.post('/logout', authenticateSession, (req, res) => {
    sessions.delete(req.sessionKey);
    res.json({ message: 'Logout realizado com sucesso' });
});

app.post('/start-bot', authenticateSession, (req, res) => {
    if (botRunning) return res.status(400).json({ message: 'Bot já está em execução!' });
    botRunning = true;
    startBot({ send: (type, message) => sendLog(message) });
    res.json({ message: 'Bot iniciado.' });
});

app.post('/stop-bot', authenticateSession, async (req, res) => {
    if (!botRunning) return res.status(400).json({ message: 'Bot não está em execução!' });
    await stopBot();
    res.json({ message: 'Bot parado.' });
});

app.get('/status', authenticateSession, (req, res) => {
    res.json({ running: botRunning });
});

app.post('/clear-session', authenticateSession, async (req, res) => {
    if (botRunning) await stopBot();
    await clearSession();
    res.json({ message: 'Sessão limpa com sucesso.' });
});

app.post('/reset-stats', authenticateSession, async (req, res) => {
    try {
        await pool.query('DELETE FROM sent_messages; DELETE FROM stats;');
        res.json({ message: 'Estatísticas resetadas com sucesso.' });
    } catch (error) {
        console.error('Erro ao resetar estatísticas:', error);
        res.status(500).json({ message: 'Erro ao resetar estatísticas' });
    }
});

app.get('/stats', authenticateSession, async (req, res) => {
    try {
        const result = await pool.query('SELECT day, total_sent, agents FROM stats');
        const statsData = {
            totalSent: 0,
            porDia: { segunda: 0, terça: 0, quarta: 0, quinta: 0, sexta: 0 },
            porAgente: { segunda: {}, terça: {}, quarta: {}, quinta: {}, sexta: {} },
        };

        result.rows.forEach(row => {
            statsData.totalSent += row.total_sent;
            const dia = row.day.toLowerCase();
            if (diasSemana.includes(dia)) {
                statsData.porDia[dia] = row.total_sent;
                statsData.porAgente[dia] = row.agents || {};
            }
        });

        res.json(statsData);
    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        res.status(500).json({ message: 'Erro ao carregar estatísticas' });
    }
});

app.get('/contact-logs', authenticateSession, (req, res) => {
    res.json(contactLogs);
});

app.get('/search-students', authenticateSession, async (req, res) => {
    const { name } = req.query;
    try {
        const alunos = await fetchEnrolled();
        const uniqueAlunos = Array.from(
            new Map(alunos.map(aluno => [aluno.registrationCode, aluno])).values()
        );
        if (!name) {
            return res.json(uniqueAlunos);
        }
        const filteredAlunos = uniqueAlunos.filter(aluno =>
            aluno.nomeCompleto.toLowerCase().includes(name.toLowerCase())
        );
        res.json(filteredAlunos);
    } catch (error) {
        console.error('Erro ao buscar alunos:', error);
        res.status(500).json({ message: 'Erro ao buscar alunos', error: error.message });
    }
});

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionKey = url.searchParams.get('sessionKey');

    if (!sessionKey || !sessions.has(sessionKey)) {
        ws.close(1008, 'Não autorizado');
        return;
    }

    console.log('Novo cliente WebSocket conectado');
    wssClients.push(ws);

    const pingInterval = setInterval(() => {
        if (ws.isAlive === false) {
            wssClients = wssClients.filter(client => client !== ws);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    }, 60000); // Aumentado para 60 segundos para reduzir sobrecarga

    ws.isAlive = true;
    ws.on('pong', () => ws.isAlive = true);
    ws.on('close', () => {
        console.log('Cliente WebSocket desconectado');
        wssClients = wssClients.filter(client => client !== ws);
        clearInterval(pingInterval);
    });
});

const sendLog = (message) => {
    wssClients.forEach(client => {
        if (client.readyState === 1) {
            client.send(JSON.stringify({ type: 'log', message }));
        }
    });
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const addContactLog = (agent, student, registrationCode, reason) => {
    const logKey = `${agent}-${student}-${registrationCode}-${reason}`;
    if (!contactLogs.some(log => `${log.agent}-${log.student}-${log.registrationCode}-${log.reason}` === logKey)) {
        contactLogs.push({ agent, student, registrationCode, reason });
    }
};

async function useDatabaseAuthState() {
    const saveCreds = async (creds) => {
        try {
            await pool.query(
                'INSERT INTO auth_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
                ['creds', JSON.stringify(creds)]
            );
            console.log('Credenciais salvas com sucesso');
        } catch (err) {
            console.error('Erro ao salvar credenciais:', err);
            sendLog(`⚠️ Erro ao salvar credenciais: ${err.message}`);
        }
    };

    const loadCreds = async () => {
        try {
            const result = await pool.query('SELECT value FROM auth_state WHERE key = $1', ['creds']);
            const creds = result.rows.length > 0 ? JSON.parse(result.rows[0].value) : {};
            console.log('Credenciais carregadas:', creds.me ? 'Encontradas' : 'Não encontradas ou novas');
            return creds;
        } catch (err) {
            console.error('Erro ao carregar credenciais:', err);
            sendLog(`⚠️ Erro ao carregar credenciais: ${err.message}`);
            return {};
        }
    };

    const state = {
        creds: await loadCreds(),
        keys: {
            get: async (type, ids) => {
                try {
                    const result = await pool.query('SELECT value FROM auth_state WHERE key = $1', [type]);
                    return result.rows.length > 0 ? JSON.parse(result.rows[0].value) : {};
                } catch (err) {
                    console.error(`Erro ao carregar keys (${type}):`, err);
                    sendLog(`⚠️ Erro ao carregar keys (${type}): ${err.message}`);
                    return {};
                }
            },
            set: async (data) => {
                for (const [key, value] of Object.entries(data)) {
                    try {
                        await pool.query(
                            'INSERT INTO auth_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
                            [key, JSON.stringify(value)]
                        );
                    } catch (err) {
                        console.error(`Erro ao salvar keys (${key}):`, err);
                        sendLog(`⚠️ Erro ao salvar keys (${key}): ${err.message}`);
                    }
                }
            }
        }
    };

    return { state, saveCreds };
}

async function initializeContactLogs() {
    try {
        const alunos = await fetchEnrolled();
        console.log(`📋 Inicializando contatos inválidos... Total de alunos: ${alunos.length}`);

        for (const aluno of alunos) {
            if (!['Ativo', 'EmRecuperacao', 'Atencao'].includes(aluno.status)) continue;

            const { numeroParaEnvio } = formatarNumeroTelefone(aluno.cel ?? '');
            const primeiroNome = extrairPrimeiroNome(aluno.nomeCompleto);
            const agenteRaw = aluno.agenteDoSucesso ?? '';
            const agente = extrairNomeDoEmail(agenteRaw);
            const registrationCode = aluno.registrationCode ?? 'Desconhecido';

            const erros = [];
            if (!numeroParaEnvio) erros.push('Número inválido');
            if (!primeiroNome) erros.push('Nome inválido');
            if (!agenteRaw.includes('@')) erros.push('Agente do sucesso não é um email válido');
            if (!agente) erros.push('Nome do agente não pôde ser extraído');
            if (!aluno.monitoringLink) erros.push('Link de monitoria ausente');
            if (!aluno.monitoringDay) erros.push('Dia da monitoria ausente');

            if (erros.length > 0) {
                addContactLog(agente, primeiroNome || 'Nome Desconhecido', registrationCode, erros.join(', '));
                console.log(`⚠️ Contato inválido inicializado: ${primeiroNome || 'Nome Desconhecido'} (Registration Code: ${registrationCode}) - ${erros.join(', ')}`);
            }
        }
        console.log(`📊 Contatos inválidos pré-carregados: ${contactLogs.length}`);
    } catch (error) {
        console.error('Erro ao inicializar contatos inválidos:', error);
        sendLog(`⚠️ Erro ao inicializar contatos inválidos: ${error.message}`);
    }
}

async function startBot(sender) {
    if (isRunning) {
        sender.send('log', '⚠️ Bot já está em execução...');
        return;
    }

    if (sock) {
        await stopBot();
    }

    isRunning = true;
    botRunning = true;
    stopSignal = null;
    sender.send('log', 'Iniciando o bot...');

    try {
        const { state, saveCreds } = await useDatabaseAuthState();
        const { version } = await fetchLatestBaileysVersion();

        const hasValidCreds = !!state?.creds?.me;
        sender.send('log', `ℹ️ Credenciais válidas encontradas? ${hasValidCreds} (creds: ${state.creds ? JSON.stringify(state.creds) : 'vazio'})`);

        sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            logger: P({ level: 'info' }),
            browser: Browsers.macOS('Desktop'),
            syncFullHistory: false,
            generateHighQualityLinkPreview: false,
            patchMessageBeforeSending: (message) => {
                const requiresPatch = !!(
                    message.buttonsMessage ||
                    message.templateMessage ||
                    message.listMessage
                );
                if (requiresPatch) {
                    message = {
                        viewOnceMessage: {
                            message: {
                                messageContextInfo: {
                                    deviceListMetadataVersion: 2,
                                    deviceListMetadata: {},
                                },
                                ...message,
                            },
                        },
                    };
                }
                return message;
            },
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr, isNewLogin } = update;
            const error = lastDisconnect?.error;
            const statusCode = error?.output?.statusCode || 'Desconhecido';
            const errorMessage = error?.message || 'Sem mensagem';
            console.log(`Conexão: ${connection}, Status: ${statusCode}, Mensagem: ${errorMessage}, QR: ${!!qr}, Novo Login: ${!!isNewLogin}`);
            sender.send('log', `ℹ️ Conexão: ${connection}, Status: ${statusCode}, Mensagem: ${errorMessage}`);

            if (qr) {
                const qrCodeUrl = await qrcode.toDataURL(qr);
                console.log('QR Code gerado:', qrCodeUrl);
                sender.send('qr', qrCodeUrl);
                sender.send('log', '📱 QR Code gerado. Escaneie com seu WhatsApp.');
            }

            if (isNewLogin) {
                sender.send('log', '✅ Nova sessão de login detectada.');
            }

            if (connection === 'open') {
                retryCount = 0;
                sender.send('log', '✅ Conectado ao WhatsApp!');
                await enviarMensagens(sock, sender);
            } else if (connection === 'close') {
                if (statusCode === DisconnectReason.loggedOut) {
                    sender.send('log', '❌ Sessão expirada/forçada logout. Limpando auth_state...');
                    await clearSession();
                    await stopBot();
                    sender.send('log', '📱 Nova autenticação necessária. Reiniciando bot para gerar QR code...');
                    startBot(sender);
                } else if (statusCode === DisconnectReason.connectionLost || statusCode === DisconnectReason.connectionClosed) {
                    if (retryCount < maxRetries) {
                        retryCount++;
                        sender.send('log', `🔄 Conexão perdida/fechada. Tentativa ${retryCount}/${maxRetries} em ${5 * retryCount}s...`);
                        await delay(5000 * retryCount);
                        startBot(sender);
                    } else {
                        sender.send('log', '❌ Máximo de tentativas atingido. Parando bot.');
                        await stopBot();
                    }
                } else if (statusCode === DisconnectReason.restartRequired) {
                    sender.send('log', '🔄 Reinício necessário. Reiniciando bot...');
                    await stopBot();
                    startBot(sender);
                } else if (statusCode === 403) {
                    sender.send('log', '⚠️ Conta banida temporariamente pelo WhatsApp. Aguardando 1 hora...');
                    await delay(3600000);
                    startBot(sender);
                } else {
                    if (retryCount < maxRetries) {
                        retryCount++;
                        sender.send('log', `🔄 Desconhecido (código ${statusCode}). Tentativa ${retryCount}/${maxRetries} em ${5 * retryCount}s...`);
                        await stopBot();
                        startBot(sender);
                    } else {
                        sender.send('log', '❌ Máximo de tentativas atingido. Parando bot.');
                        await stopBot();
                    }
                }
            }
        });

        let lastSyncLogTime = 0;
        sock.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest }) => {
            const now = Date.now();
            if (now - lastSyncLogTime > 5000) {
                sender.send('log', '📥 Sincronização concluída com sucesso.');
                lastSyncLogTime = now;
            }
        });
    } catch (err) {
        console.error('Erro ao iniciar bot:', err);
        sender.send('log', `❌ Erro ao iniciar bot: ${err.message}`);
        await stopBot();
        if (err.message.includes('Cannot read properties of null') || err.message.includes('Cannot destructure property \'creds\'')) {
            sender.send('log', '📱 Credenciais ausentes ou inválidas. Gerando novo QR code na próxima tentativa...');
            await clearSession();
            startBot(sender);
        }
    }
}

async function stopBot() {
    if (sock) {
        try {
            await sock.logout();
        } catch (err) {
            console.error('Erro ao fazer logout:', err);
            sendLog(`⚠️ Erro ao fazer logout: ${err.message}`);
        }
        sock.ev.removeAllListeners();
        sock.end();
        sock = null;
    }
    isRunning = false;
    botRunning = false;
    stopSignal = new Error('Bot parado');
    sendLog('⛔ Bot parado.');
}

async function clearSession() {
    try {
        await pool.query('DELETE FROM auth_state');
        sendLog('🧹 Sessão limpa com sucesso.');
    } catch (error) {
        console.error('Erro ao limpar sessão:', error);
        sendLog(`⚠️ Erro ao limpar sessão: ${error.message}`);
    }
}

function formatarNumeroTelefone(numero) {
    if (!numero) return { numeroFormatado: null, numeroParaEnvio: null };
    let numeroLimpo = numero.replace(/\D/g, '');
    if (numeroLimpo.startsWith('0055')) numeroLimpo = numeroLimpo.slice(4);
    else if (numeroLimpo.startsWith('55')) numeroLimpo = numeroLimpo.slice(2);
    if (numeroLimpo.length < 10) return { numeroFormatado: null, numeroParaEnvio: null };
    const ddd = numeroLimpo.slice(0, 2);
    let corpo = numeroLimpo.slice(2);
    if (corpo.length === 9 && corpo.startsWith('9')) corpo = corpo.slice(1);
    if (corpo.length !== 8) return { numeroFormatado: null, numeroParaEnvio: null };
    const parte1 = corpo.slice(0, 4);
    const parte2 = corpo.slice(4);
    const numeroFormatado = `+55 ${ddd} ${parte1}-${parte2}`;
    const numeroParaEnvio = numeroFormatado;
    return { numeroFormatado, numeroParaEnvio };
}

function extrairPrimeiroNome(nome) {
    return nome?.split(' ')[0] ?? '';
}

function extrairNomeDoEmail(email) {
    if (!email || !email.includes('@')) return '';
    const parteNome = email.split('@')[0];
    let partes = parteNome.split(/[._]/);
    if (partes.length === 1) {
        const nomeSemSeparadores = partes[0].toLowerCase();
        if (nomeSemSeparadores === 'miguelsilva') partes = ['miguel', 'silva'];
        else if (nomeSemSeparadores === 'lucasgarcia') partes = ['lucas', 'garcia'];
        else if (nomeSemSeparadores === 'jhulybastos') partes = ['jhuly', 'bastos'];
        else partes = [nomeSemSeparadores];
    }
    return partes.map(parte => parte.charAt(0).toUpperCase() + parte.slice(1).toLowerCase()).join(' ');
}

async function carregarContatos(sender) {
    const contatosPorDia = {};
    try {
        const alunos = await fetchEnrolled();
        sender.send('log', `📋 Carregando contatos... Total de alunos: ${alunos.length}`);

        for (const aluno of alunos) {
            if (!['Ativo', 'EmRecuperacao', 'Atencao'].includes(aluno.status)) continue;

            const { numeroParaEnvio, numeroFormatado } = formatarNumeroTelefone(aluno.cel ?? '');
            const primeiroNome = extrairPrimeiroNome(aluno.nomeCompleto);
            const agenteRaw = aluno.agenteDoSucesso ?? '';
            const agente = extrairNomeDoEmail(agenteRaw);
            const monitoringDay = aluno.monitoringDay ?? '';
            const [dia] = monitoringDay.split(' às');
            const diaChave = dia?.toLowerCase()?.trim() || '';
            const registrationCode = aluno.registrationCode ?? 'Desconhecido';

            const erros = [];
            if (!numeroParaEnvio) erros.push('Número inválido');
            if (!primeiroNome) erros.push('Nome inválido');
            if (!agenteRaw.includes('@')) erros.push('Agente do sucesso não é um email válido');
            if (!agente) erros.push('Nome do agente não pôde ser extraído');
            if (!aluno.monitoringLink) erros.push('Link de monitoria ausente');
            if (!diaChave) erros.push('Dia da monitoria ausente');

            if (erros.length > 0) {
                const logExists = contactLogs.some(log =>
                    log.agent === agente &&
                    log.student === (primeiroNome || 'Nome Desconhecido') &&
                    log.registrationCode === registrationCode &&
                    log.reason === erros.join(', ')
                );
                if (!logExists) {
                    addContactLog(agente, primeiroNome || 'Nome Desconhecido', registrationCode, erros.join(', '));
                    sender.send('log', `⚠️ Contato inválido: ${primeiroNome || 'Nome Desconhecido'} (Registration Code: ${registrationCode}) - ${erros.join(', ')}`);
                }
                continue;
            }

            if (!contatosPorDia[diaChave]) contatosPorDia[diaChave] = [];
            contatosPorDia[diaChave].push({
                numero: numeroParaEnvio,
                numeroFormatado,
                nome: primeiroNome,
                agenteDoSucesso: agenteRaw,
                agenteNome: agente,
                monitoringDay: aluno.monitoringDay,
                monitoringLink: aluno.monitoringLink,
                registrationCode
            });
        }

        sender.send('log', `📊 Contatos carregados: ${JSON.stringify(Object.keys(contatosPorDia))}`);
        return contatosPorDia;
    } catch (error) {
        console.error('Erro ao carregar contatos:', error);
        sender.send('log', `⚠️ Erro ao carregar contatos: ${error.message}`);
        throw error;
    }
}

async function enviarMensagens(sock, sender) {
    const monitorResources = () => {
        const used = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        const memoryInfo = `Memória: RSS=${(used.rss / 1024 / 1024).toFixed(2)}MB, Heap=${(used.heapUsed / 1024 / 1024).toFixed(2)}MB/${(used.heapTotal / 1024 / 1024).toFixed(2)}MB`;
        const cpuInfo = `CPU: User=${(cpuUsage.user / 1000000).toFixed(2)}s, System=${(cpuUsage.system / 1000000).toFixed(2)}s`;
        console.log(`${memoryInfo}, ${cpuInfo}`);
        sendLog(`📈 ${memoryInfo}, ${cpuInfo}`);
    };
    setInterval(monitorResources, 60000);

    try {
        await pool.query('SELECT 1');
        sender.send('log', '✅ Conexão com o banco de dados verificada.');
    } catch (err) {
        console.error('Erro ao verificar conexão com o banco:', err);
        sender.send('log', `⚠️ Erro ao verificar conexão com o banco: ${err.message}`);
        throw err;
    }

    const contatos = await carregarContatos(sender);
    const hoje = new Date().toLocaleString('pt-BR', { weekday: 'long' }).toLowerCase().replace('-feira', '').trim();
    sender.send('log', `📅 Hoje é: ${hoje}`);

    if (!contatos[hoje] || contatos[hoje].length === 0) {
        sender.send('log', `⚠️ Nenhum contato válido para hoje (${hoje}).`);
        const stats = await loadStats(hoje);
        sender.send('log', `📊 Estatísticas por Dia - ${hoje.charAt(0).toUpperCase() + hoje.slice(1)}: Total Enviadas: ${stats.total_sent}`);
        return;
    }

    let { total_sent: totalSent, agents: initialAgents } = await loadStats(hoje);
    const statsPorDia = { [hoje]: totalSent };
    const statsPorAgente = { [hoje]: { ...initialAgents } };

    const todosAgentes = [...new Set(contatos[hoje].map(c => c.agenteNome))];
    todosAgentes.forEach(agente => {
        statsPorAgente[hoje][agente] = statsPorAgente[hoje][agente] || 0;
    });

    sender.send('log', `📊 Estatísticas do Envio: Total Enviadas: ${totalSent}`);

    const mensagensPorHora = 50;
    let mensagensEnviadasNaHora = 0;
    let ultimaHora = new Date().getHours();

    const contatosOrdenados = [...contatos[hoje]].sort((a, b) => {
        const [_, horaA] = a.monitoringDay.split(' às') || ['00:00'];
        const [__, horaB] = b.monitoringDay.split(' às') || ['00:00'];
        return horaA.localeCompare(horaB);
    });

    for (const contato of contatosOrdenados) {
        if (stopSignal) {
            sender.send('log', '⛔ Envio de mensagens interrompido: Bot foi parado.');
            throw stopSignal;
        }

        const horaAtual = new Date().getHours();
        if (horaAtual !== ultimaHora) {
            mensagensEnviadasNaHora = 0;
            ultimaHora = horaAtual;
        }
        if (mensagensEnviadasNaHora >= mensagensPorHora) {
            sender.send('log', `⏳ Limite de ${mensagensPorHora} mensagens/hora atingido. Aguardando próxima hora...`);
            await delay(3600000 - (Date.now() % 3600000));
            mensagensEnviadasNaHora = 0;
        }

        if (await isMessageSent(contato.registrationCode, contato.monitoringDay)) {
            sender.send('log', `⏩ Pulando ${contato.nome} (já enviado)`);
            continue;
        }

        const numeroLimpo = contato.numero.replace(/\D/g, '');
        const numeroWhatsApp = `${numeroLimpo}@s.whatsapp.net`;
        const agenteNome = contato.agenteNome;
        const mensagem = `Olá ${contato.nome.toUpperCase()}! \n🚀 Lembrete do atendimento semanal com ${agenteNome}, \n${contato.monitoringDay}. Posso contar com você? 👇\n${contato.monitoringLink}`;

        try {
            await Promise.race([
                sock.sendMessage(numeroWhatsApp, { text: mensagem }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Tempo limite excedido')), 15000))
            ]);
            totalSent++;
            statsPorDia[hoje]++;
            statsPorAgente[hoje][agenteNome] = (statsPorAgente[hoje][agenteNome] || 0) + 1;

            await markMessageAsSent(contato.registrationCode, contato.monitoringDay);
            await saveStats(hoje, totalSent, statsPorAgente[hoje]);

            sender.send('log', `✅ Mensagem enviada para ${contato.numeroFormatado} às ${contato.monitoringDay.split(' às')[1] || 'horário não especificado'}`);
            sender.send('log', `📊 Estatísticas do Envio: Total Enviadas: ${totalSent}`);
            sender.send('log', `📊 Estatísticas por Dia - ${hoje.charAt(0).toUpperCase() + hoje.slice(1)}: Total Enviadas: ${statsPorDia[hoje]}`);
            sender.send('log', JSON.stringify({ type: 'agentStats', data: { day: hoje, agents: statsPorAgente[hoje] } }));
            mensagensEnviadasNaHora++;
        } catch (err) {
            if (err === stopSignal) throw err;
            console.error(`Erro ao enviar mensagem para ${contato.numeroFormatado} (${contato.registrationCode}):`, err);
            sender.send('log', `⚠️ Falha ao enviar para ${contato.numeroFormatado} (Registration Code: ${contato.registrationCode}): ${err.message}`);
            continue;
        }

        sender.send('log', `⏳ Aguardando 60s...`);
        await delay(60000);
    }

    sender.send('log', `📊 Estatísticas Finais: Total Enviadas: ${totalSent}`);
    sender.send('log', JSON.stringify({ type: 'agentStats', data: { day: hoje, agents: statsPorAgente[hoje] } }));
    await saveStats(hoje, totalSent, statsPorAgente[hoje]);
}

async function isMessageSent(registrationCode, monitoringDay) {
    try {
        const result = await pool.query(
            'SELECT 1 FROM sent_messages WHERE registration_code = $1 AND monitoring_day = $2',
            [registrationCode, monitoringDay]
        );
        return result.rows.length > 0;
    } catch (err) {
        console.error(`Erro ao verificar mensagem enviada (${registrationCode}):`, err);
        sendLog(`⚠️ Erro no banco (isMessageSent): ${err.message}`);
        return false;
    }
}

async function markMessageAsSent(registrationCode, monitoringDay) {
    try {
        await pool.query(
            'INSERT INTO sent_messages (registration_code, monitoring_day) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [registrationCode, monitoringDay]
        );
        console.log(`✅ Mensagem marcada como enviada: ${registrationCode}`);
    } catch (err) {
        console.error(`Erro ao marcar mensagem como enviada (${registrationCode}):`, err);
        sendLog(`⚠️ Erro no banco (markMessageAsSent): ${err.message}`);
        throw err;
    }
}

async function loadStats(day) {
    try {
        const result = await pool.query('SELECT total_sent, agents FROM stats WHERE day = $1', [day]);
        return result.rows.length > 0 ? result.rows[0] : { total_sent: 0, agents: {} };
    } catch (err) {
        console.error(`Erro ao carregar estatísticas (${day}):`, err);
        sendLog(`⚠️ Erro no banco (loadStats): ${err.message}`);
        return { total_sent: 0, agents: {} };
    }
}

async function saveStats(day, totalSent, agents) {
    try {
        await pool.query(
            'INSERT INTO stats (day, total_sent, agents) VALUES ($1, $2, $3) ON CONFLICT (day) DO UPDATE SET total_sent = $2, agents = $3',
            [day, totalSent, JSON.stringify(agents)]
        );
        console.log(`✅ Estatísticas salvas para ${day}: ${totalSent}`);
    } catch (err) {
        console.error(`Erro ao salvar estatísticas (${day}):`, err);
        sendLog(`⚠️ Erro no banco (saveStats): ${err.message}`);
        throw err;
    }
}

process.on('uncaughtException', (err) => {
    console.error('Erro não tratado:', err);
    sendLog(`❌ Erro não tratado: ${err.message}`);
});

process.on('unhandledRejection', (reason) => {
    console.error('Rejeição não tratada:', reason);
    sendLog(`❌ Rejeição não tratada: ${reason.message || reason}`);
});