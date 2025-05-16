require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const qrcode = require('qrcode');
const { fetchEnrolled } = require('./services/api');
const fs = require('fs').promises;
const P = require('pino');

const app = express();
const port = process.env.PORT || 5000;

const allowedOrigins = [
    process.env.FRONTEND_URL || 'https://seufrontend.netlify.app',
    'http://localhost:5173',
];

// Middleware para OPTIONS
app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.url} de ${req.headers.origin}`);
    if (req.method === 'OPTIONS') {
        console.log(`[OPTIONS] Requisição para ${req.url}`);
        res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes(req.headers.origin) ? req.headers.origin : '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-key');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
        console.log('[OPTIONS] Respondendo com 200 OK');
        return res.status(200).send();
    }
    next();
});

// Middleware de CORS
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Origem não permitida pelo CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-session-key'],
}));

app.use(express.json());

let botRunning = false;
let wssClients = [];
let sock = null;
let isRunning = false;
let stopSignal = null;
let contactLogs = [];
const sessions = new Map();

const server = app.listen(port, () => {
    console.log(`Backend rodando na porta ${port}`);
});

const wss = new WebSocketServer({ server });

// Função para gerar chave de sessão
const generateSessionKey = () => {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
};

// Middleware de autenticação
const authenticateSession = (req, res, next) => {
    const sessionKey = req.headers['x-session-key'];
    if (!sessionKey || !sessions.has(sessionKey)) {
        console.log(`[AUTH] Falha na autenticação: sessionKey=${sessionKey}`);
        return res.status(401).json({ message: 'Não autorizado' });
    }
    req.sessionKey = sessionKey;
    next();
};

// Rota de login
app.post('/login', (req, res) => {
    console.log(`[POST /login] Requisição de ${req.headers.origin}`);
    const { username, password } = req.body;

    const validUsername = process.env.ADMIN_USERNAME || 'admin';
    const validPassword = process.env.ADMIN_PASSWORD || '123456';

    if (username !== validUsername || password !== validPassword) {
        console.log(`[POST /login] Credenciais inválidas: username=${username}`);
        return res.status(401).json({ message: 'Usuário ou senha incorretos' });
    }

    const sessionKey = generateSessionKey();
    sessions.set(sessionKey, { username });
    console.log(`[POST /login] Sessão criada: ${sessionKey}`);
    res.json({ sessionKey });
});

// ... restante do código inalterado ...

module.exports = app;
// Rota de logout
app.post('/logout', authenticateSession, (req, res) => {
    sessions.delete(req.sessionKey);
    res.json({ message: 'Logout realizado com sucesso' });
});

// Proteger as rotas existentes
app.post('/start-bot', authenticateSession, (req, res) => {
    if (botRunning) return res.status(400).json({ message: 'Bot já está em execução!' });
    contactLogs = [];
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
    res.json({ message: 'Sessão limpa.' });
});

app.get('/contact-logs', authenticateSession, (req, res) => {
    res.json(contactLogs);
});

// Proteger o WebSocket
wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionKey = url.searchParams.get('sessionKey');

    if (!sessionKey || !sessions.has(sessionKey)) {
        ws.close(1008, 'Não autorizado');
        return;
    }

    console.log('Novo cliente WebSocket conectado');
    wssClients.push(ws);

    ws.on('close', () => {
        console.log('Cliente WebSocket desconectado');
        wssClients = wssClients.filter(client => client !== ws);
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

// Função para adicionar um log de não-contato
const addContactLog = (agent, student, registrationCode, reason) => {
    contactLogs.push({
        agent,
        student,
        registrationCode,
        reason,
    });
};

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
        const { state, saveCreds } = await useMultiFileAuthState('auth_info');
        const { version } = await fetchLatestBaileysVersion();

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

            if (qr) {
                const qrCodeUrl = await qrcode.toDataURL(qr);
                sender.send('qr', qrCodeUrl);
                sender.send('log', '📱 QR Code gerado. Escaneie com seu WhatsApp.');
            }

            if (isNewLogin) {
                sender.send('log', 'Nova sessão de login detectada.');
            }

            if (connection === 'open') {
                sender.send('log', '✅ Conectado ao WhatsApp!');
                await enviarMensagens(sock, sender);
            } else if (connection === 'close') {
                const errorMessage = lastDisconnect?.error?.message || 'Motivo desconhecido';
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                sender.send('log', `❌ Conexão fechada: ${errorMessage} (Código: ${statusCode})`);

                if (statusCode === DisconnectReason.loggedOut) {
                    sender.send('log', '❌ Sessão expirada. Use "Limpar Sessão" para gerar um novo QR Code.');
                    await clearSession();
                    await stopBot();
                } else {
                    sender.send('log', '🔄 Tentando reconectar...');
                    await stopBot();
                    startBot(sender);
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
        sender.send('log', `❌ Erro ao iniciar bot: ${err.message}`);
        await stopBot();
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
        await fs.rm('auth_info', { recursive: true, force: true });
        sendLog('🧹 Sessão limpa com sucesso. Pronto para gerar um novo QR Code.');
    } catch (error) {
        sendLog(`⚠️ Erro ao limpar sessão: ${error.message}`);
    }
}

function formatarNumeroTelefone(numero) {
    if (!numero) return { numeroFormatado: null, numeroParaEnvio: null };

    // Remove qualquer coisa que não for número
    let numeroLimpo = numero.replace(/\D/g, '');

    // Remove o prefixo internacional se existir (ex: +55 ou 0055)
    if (numeroLimpo.startsWith('0055')) {
        numeroLimpo = numeroLimpo.slice(4);
    } else if (numeroLimpo.startsWith('55')) {
        numeroLimpo = numeroLimpo.slice(2);
    }

    // Se tiver menos de 10 dígitos, não é válido
    if (numeroLimpo.length < 10) {
        return { numeroFormatado: null, numeroParaEnvio: null };
    }

    // Extrai o DDD (2 primeiros) e corpo do número
    const ddd = numeroLimpo.slice(0, 2);
    let corpo = numeroLimpo.slice(2);

    // Corrige se for celular com nono dígito e DDD não exigir
    // Se for 11 dígitos e começa com 9, vamos retirar o 9
    if (corpo.length === 9 && corpo.startsWith('9')) {
        corpo = corpo.slice(1); // remove o 9
    }

    // Se sobrou algo que não tenha 8 dígitos, considera inválido
    if (corpo.length !== 8) {
        return { numeroFormatado: null, numeroParaEnvio: null };
    }

    const parte1 = corpo.slice(0, 4);
    const parte2 = corpo.slice(4);

    const numeroFormatado = `+55 ${ddd} ${parte1}-${parte2}`;
    const numeroParaEnvio = numeroFormatado;

    return {
        numeroFormatado: numeroFormatado,
        numeroParaEnvio: numeroParaEnvio
    };
}

function extrairPrimeiroNome(nome) {
    return nome?.split(' ')[0] ?? '';
}

function extrairNomeDoEmail(email) {
    if (!email) return '';

    // Verifica se é um email (contém @)
    if (!email.includes('@')) {
        return '';
    }

    const parteNome = email.split('@')[0]; // Ex.: lucas.garcia ou lucasgarcia
    let partes = parteNome.split(/[._]/);

    // Se não houver separadores (ex.: lucasgarcia), só divide se for "lucasgarcia"
    if (partes.length === 1) {
        const nomeSemSeparadores = partes[0];
        // Caso específico: sabemos que "lucasgarcia" deve ser dividido em "lucas" e "garcia"
        if (nomeSemSeparadores.toLowerCase() === 'lucasgarcia') {
            partes = ['lucas', 'garcia'];
        }
        // Para outros nomes sem separadores, mantém como está
        else {
            partes = [nomeSemSeparadores];
        }
    }

    // Capitaliza cada parte e junta com espaço
    const nomeFormatado = partes
        .map(parte => parte.charAt(0).toUpperCase() + parte.slice(1).toLowerCase())
        .join(' ');

    return nomeFormatado || '';
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
                addContactLog(
                    agente,
                    primeiroNome || 'Nome Desconhecido',
                    registrationCode,
                    erros.join(', ')
                );
                sender.send('log', `⚠️ Contato inválido: ${primeiroNome || 'Nome Desconhecido'} (Registration Code: ${registrationCode}) - ${erros.join(', ')}`);
                continue;
            }

            if (!contatosPorDia[diaChave]) contatosPorDia[diaChave] = [];

            contatosPorDia[diaChave].push({
                numero: numeroParaEnvio,
                numeroFormatado,
                nome: primeiroNome,
                agenteDoSucesso: agente,
                monitoringDay: aluno.monitoringDay,
                monitoringLink: aluno.monitoringLink,
                registrationCode: registrationCode
            });
        }

        sender.send('log', `📊 Contatos carregados: ${JSON.stringify(Object.keys(contatosPorDia))}`);
        return contatosPorDia;
    } catch (error) {
        sender.send('log', `⚠️ Erro ao carregar contatos: ${error.message}`);
        throw error;
    }
}

async function enviarMensagens(sock, sender) {
    const contatos = await carregarContatos(sender);
    const hoje = new Date().toLocaleString('pt-BR', { weekday: 'long' }).toLowerCase().replace('-feira', '').trim();
    sender.send('log', `📅 Hoje é: ${hoje}`);

    if (!contatos[hoje]) {
        sender.send('log', 'Nenhum contato para hoje.');
        return;
    }

    for (const contato of contatos[hoje]) {
        if (stopSignal) {
            sender.send('log', '⛔ Envio de mensagens interrompido: Bot foi parado.');
            throw stopSignal;
        }

        const numeroLimpo = contato.numero.replace(/\D/g, '');
        const numeroWhatsApp = `${numeroLimpo}@s.whatsapp.net`;

        const mensagem = `Olá ${contato.nome}! 
🚀 Lembrete do atendimento semanal com ${contato.agenteDoSucesso}, 
${contato.monitoringDay}. Posso contar com você? 👇\n${contato.monitoringLink}`;

        try {
            if (stopSignal) {
                sender.send('log', '⛔ Envio de mensagens interrompido: Bot foi parado.');
                throw stopSignal;
            }
            await Promise.race([
                sock.sendMessage(numeroWhatsApp, { text: mensagem }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Tempo limite excedido')), 10000))
            ]);
            sender.send('log', `✅ Mensagem enviada para ${contato.numeroFormatado}`);
        } catch (err) {
            if (err === stopSignal) {
                throw err;
            }
            addContactLog(
                contato.agenteDoSucesso,
                contato.nome,
                contato.registrationCode,
                err.message
            );
            sender.send('log', `⚠️ Falha ao enviar para ${contato.numeroFormatado} (Registration Code: ${contato.registrationCode}): ${err.message}`);
        }

        sender.send('log', `⏳ Aguardando 20s...`);
        await delay(20000);
    }

    if (!stopSignal) {
        sender.send('log', '✅ Todas as mensagens do dia foram enviadas.');
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

// ...existing code...

