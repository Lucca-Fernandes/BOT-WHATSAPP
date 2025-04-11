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

app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000', // Permitir apenas o frontend
    credentials: true,
}));
app.use(express.json());

let botRunning = false;
let wssClients = [];
let sock = null;
let isRunning = false;
let stopSignal = null;
let contactLogs = [];
const sessions = new Map(); // Armazenar chaves de sessão

const server = app.listen(port, () => {
    console.log(`Backend rodando na porta ${port}`);
});

const wss = new WebSocketServer({ server });

// Função para gerar uma chave de sessão simples
const generateSessionKey = () => {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
};

// Middleware para verificar a chave de sessão
const authenticateSession = (req, res, next) => {
    const sessionKey = req.headers['x-session-key'];
    if (!sessionKey || !sessions.has(sessionKey)) {
        return res.status(401).json({ message: 'Não autorizado' });
    }
    req.sessionKey = sessionKey;
    next();
};

// Rota de login
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

// Rota de logout
app.post('/logout', authenticateSession, (req, res) => {
    sessions.delete(req.sessionKey);
    res.json({ message: 'Logout realizado com sucesso' });
});

// Proteger as rotas existentes
app.post('/start-bot', authenticateSession, (req, res) => {
    if (botRunning) return res.status(400).json({ message: 'Bot já está em execução!' });
    contactLogs = []; // Limpar logs ao iniciar o bot
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
    const numeroLimpo = numero.replace(/\D/g, '');
    if (numeroLimpo.length >= 11) {
        return {
            numeroFormatado: `+${numeroLimpo.slice(0, 2)} ${numeroLimpo.slice(2, 4)} ${numeroLimpo.slice(4, 9)}-${numeroLimpo.slice(9 | 'Desconhecido')}`,
            numeroParaEnvio: numeroLimpo
        };
    }
    return { numeroFormatado: null, numeroParaEnvio: null };
}

function extrairPrimeiroNome(nome) {
    return nome?.split(' ')[0] ?? '';
}

function extrairNomeDoEmail(email) {
    return email?.split('@')[0]?.replace(/[._]/g, ' ') ?? '';
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
            const agente = extrairNomeDoEmail(aluno.agenteDoSucesso);
            const monitoringDay = aluno.monitoringDay ?? '';
            const [dia] = monitoringDay.split(' às');
            const diaChave = dia?.toLowerCase()?.trim() || '';
            const registrationCode = aluno.registrationCode ?? 'Desconhecido';

            if (!numeroParaEnvio || !primeiroNome || !aluno.monitoringLink || !diaChave) {
                addContactLog(
                    agente,
                    primeiroNome || 'Nome Desconhecido',
                    registrationCode,
                    'Faltando dados'
                );
                sender.send('log', `⚠️ Contato inválido: ${primeiroNome || 'Nome Desconhecido'} (Registration Code: ${registrationCode}) - Faltando dados`);
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

        const numeroWhatsApp = `${contato.numero}@s.whatsapp.net`;
        const mensagem = `Olá ${contato.nome}! 🚀 Lembrete do atendimento semanal com ${contato.agenteDoSucesso}, ${contato.monitoringDay}. Posso contar com você? 👇\n${contato.monitoringLink}`;

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