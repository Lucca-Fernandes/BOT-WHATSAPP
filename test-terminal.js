const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const fs = require('fs');
const path = require('path');

// Caminho da pasta de autenticação
const AUTH_FOLDER = './auth_info';

// 🔁 (Opcional) Limpar sessão antiga
const clearSession = false;
if (clearSession && fs.existsSync(AUTH_FOLDER)) {
    fs.rmSync(AUTH_FOLDER, { recursive: true });
    console.log('🧹 Sessão anterior removida.');
}

// Função principal para iniciar o bot
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: P({ level: 'silent' }),
        printQRInTerminal: true,
        browser: Browsers.macOS('Desktop'), // Mais seguro que 'Ubuntu Chrome'
        auth: state,
        syncFullHistory: false,
    });

    // Salvar credenciais ao atualizar
    sock.ev.on('creds.update', saveCreds);

    // QR Code gerado
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('📱 QR Code gerado. Escaneie com seu WhatsApp.');
        }

        if (connection === 'close') {
            const shouldReconnect = 
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Conexão fechada. Motivo:', lastDisconnect?.error?.message);
            if (shouldReconnect) {
                console.log('🔄 Tentando reconectar...');
                startBot(); // Reconnect
            } else {
                console.log('🚫 Logout detectado. Escaneie um novo QR code.');
            }
        }

        if (connection === 'open') {
            console.log('✅ Conectado ao WhatsApp!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const msg = messages[0];
        if (!msg.message) return;

        const sender = msg.key.remoteJid;
        const content = msg.message.conversation || msg.message.extendedTextMessage?.text;

        console.log(`📩 Mensagem de ${sender}: ${content}`);
        // Exemplo de resposta
        if (content === '!ping') {
            await sock.sendMessage(sender, { text: '🏓 Pong!' });
        }
    });
}

startBot();
