const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');

async function conectarWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log(" Escaneie este QR Code para conectar:");
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log('✅ Conectado ao WhatsApp!');
            enviarMensagens(sock);
        } else if (connection === 'close') {
            console.log('❌ Conexão fechada! Tentando reconectar...');
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => {
                    conectarWhatsApp();
                }, 5000);
            } else {
                console.log("❌ Usuário deslogado! Escaneie o QR Code novamente.");
                process.exit();
            }
        }
    });

    return sock;
}

async function enviarMensagens(sock) {
    const contatos = {
        "segunda": ["+55 37 9815-0084","+55 37 8833-3648","+55 37 9998-8455", "+55 31 8722-1031"],
    };

    const hoje = new Date().toLocaleString('pt-BR', { weekday: 'long' }).toLowerCase().replace('feira', '').replace('-', '').trim();

    console.log(`Hoje é: ${hoje}`);

    if (contatos[hoje]) {
        for (const numero of contatos[hoje]) {
            let numeroFormatado = numero;

            // Remove caracteres não numéricos
            numeroFormatado = numeroFormatado.replace(/\D/g, '');

           

            const numeroWhatsApp = `${numeroFormatado}@s.whatsapp.net`;

            try {
                await sock.sendMessage(numeroWhatsApp, { text: 'Olá PDev, temos um encontro marcado hoje. Posso contar com a sua presença?' });
                console.log(` Mensagem enviada para ${numeroFormatado}`);
            } catch (error) {
                console.error(`⚠️ Erro ao enviar mensagem para ${numeroFormatado}:`, error);
            }
        }
    } else {
        console.log(" Nenhum contato para enviar hoje.");
    }
}

conectarWhatsApp();