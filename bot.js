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

app.use(cors());
app.use(express.json());

let botRunning = false;
let wssClients = [];
let sock = null;
let isRunning = false;
let stopSignal = null;

const server = app.listen(port, () => {
    console.log(`Backend rodando na porta ${port}`);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
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

async function startBot(sender) {
    if (isRunning) {
        sender.send('log', '⚠️ Bot já está em execução...');
        return;
    }

    // Limpar qualquer estado pendente
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
            numeroFormatado: `+${numeroLimpo.slice(0, 2)} ${numeroLimpo.slice(2, 4)} ${numeroLimpo.slice(4, 9)}-${numeroLimpo.slice(9)}`,
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

            // Removido o log detalhado de cada aluno
            // sender.send('log', `🔍 Aluno: ${primeiroNome}, Dia: ${diaChave}, Monitoring: ${monitoringDay}`);

            if (!numeroParaEnvio || !primeiroNome || !aluno.monitoringLink || !diaChave) {
                // Removido o log de erro por falta de dados
                // sender.send('log', `⚠️ Contato inválido: ${primeiroNome} (Faltando dados)`);
                continue;
            }

            if (!contatosPorDia[diaChave]) contatosPorDia[diaChave] = [];

            contatosPorDia[diaChave].push({
                numero: numeroParaEnvio,
                numeroFormatado,
                nome: primeiroNome,
                agenteDoSucesso: agente,
                monitoringDay: aluno.monitoringDay,
                monitoringLink: aluno.monitoringLink
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
            // Removido o nome do aluno do log de erro
            sender.send('log', `⚠️ Falha ao enviar para ${contato.numeroFormatado}: ${err.message}`);
        }

        sender.send('log', `⏳ Aguardando 20s...`);
        await delay(20000);
    }

    if (!stopSignal) {
        sender.send('log', '✅ Todas as mensagens do dia foram enviadas.');
    }
}

app.post('/start-bot', (req, res) => {
    if (botRunning) return res.status(400).json({ message: 'Bot já está em execução!' });
    botRunning = true;
    startBot({ send: (type, message) => sendLog(message) });
    res.json({ message: 'Bot iniciado.' });
});

app.post('/stop-bot', async (req, res) => {
    if (!botRunning) return res.status(400).json({ message: 'Bot não está em execução!' });
    await stopBot();
    res.json({ message: 'Bot parado.' });
});

app.get('/status', (req, res) => {
    res.json({ running: botRunning });
});

app.post('/clear-session', async (req, res) => {
    if (botRunning) await stopBot();
    await clearSession();
    res.json({ message: 'Sessão limpa.' });
});

process.on('uncaughtException', (err) => {
    console.error('Erro não tratado:', err);
    sendLog(`❌ Erro não tratado: ${err.message}`);
});

process.on('unhandledRejection', (reason) => {
    console.error('Rejeição não tratada:', reason);
    sendLog(`❌ Rejeição não tratada: ${reason.message || reason}`);
});