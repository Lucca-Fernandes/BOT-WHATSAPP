require('dotenv').config();
const fs = require('fs');
const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcodeTerminal = require('qrcode-terminal');
const P = require('pino');

function formatarNumeroTelefone(numero) {
    if (!numero) return null;

    let numeroLimpo = numero.replace(/\D/g, '');

    if (numeroLimpo.startsWith('0055')) numeroLimpo = numeroLimpo.slice(4);
    else if (numeroLimpo.startsWith('55')) numeroLimpo = numeroLimpo.slice(2);
    else if (numeroLimpo.startsWith('0')) numeroLimpo = numeroLimpo.slice(1);

    if (numeroLimpo.length < 10 || numeroLimpo.length > 11) return null;

    const ddd = numeroLimpo.slice(0, 2);
    let corpo = numeroLimpo.slice(2);

    if (corpo.length === 9 && corpo.startsWith('9')) {
        corpo = corpo.slice(1);
    }

    if (corpo.length !== 8) return null;

    return `55${ddd}${corpo}`;
}

async function loadContactsFromCSV(filePath) {
    const contacts = [];
    const data = fs.readFileSync(filePath, 'utf-8');
    const lines = data.trim().split('\n').slice(1); 

    for (const line of lines) {
        const [nome, celular] = line.split(',').map(item => item.trim().replace(/^"/, '').replace(/"$/, ''));
        if (nome && celular) {
            const numeroFormatado = formatarNumeroTelefone(celular);
            if (numeroFormatado) {
                contacts.push({ nome, numero: numeroFormatado });
            } else {
                console.log(`Número inválido ignorado: ${celular} (nome: ${nome})`);
            }
        }
    }
    return contacts;
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: P({ level: 'silent' }),
        printQRInTerminal: true,
        browser: Browsers.macOS('Desktop'),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) {
            qrcodeTerminal.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = (update.lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            if (shouldReconnect) {
                startBot();
            }
        }
        if (connection === 'open') {
            console.log('Conectado ao WhatsApp!');
            sendMessages(sock);
        }
    });
}

async function sendMessages(sock) {
    const filePath = 'Cópia de Cópia de Planilha geral - relatório dos alunos PD (2) - Panel Title-data-2026-01-06 17_ (1).csv';
    const contacts = await loadContactsFromCSV(filePath);
    console.log(`Carregados ${contacts.length} contatos válidos do CSV.`);

    for (const contact of contacts) {
        const numeroWhatsApp = `${contact.numero}@s.whatsapp.net`;

        const mensagem = `Olá ${contact.nome}! Contamos muito com a ajuda de vocês para responder a está pergunta, qual horário de monitoria obrigatória semanal fica melhor para sua rotina?\n\nTurno manhã 9:00 às 15:00\nTurno tarde 15:00 às 21:00\n\nMesmo que você já possua agendamento pedimos para que nos informe qual turno se encaixa melhor na sua rotina e se possível um horário fixo para realização das monitorias semanais, obrigado!`;

        try {
            await sock.sendMessage(numeroWhatsApp, { text: mensagem });
            console.log(`Mensagem enviada para ${contact.nome} (${contact.numero}) → formato: ${contact.numero}`);
            await new Promise(resolve => setTimeout(resolve, 40000)); 
        } catch (err) {
            console.error(`Erro ao enviar para ${contact.numero}: ${err.message}`);
        }
    }
    console.log('Envio concluído!');
}

startBot();