require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const { fetchEnrolled } = require('./services/api');
const fs = require('fs').promises;

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

let botRunning = false;
let testMode = true;
let wssClients = [];
let sock = null;
let isRunning = false;

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

async function startBot(sender, TEST_MODE) {
    if (isRunning) {
        sender.send('log', 'Bot já está em execução!');
        return;
    }

    isRunning = true;
    botRunning = true;
    testMode = TEST_MODE;
    sender.send('log', `Iniciando o bot... (Modo de teste: ${testMode})`);

    if (testMode) {
        sender.send('log', '🚀 Modo de teste ativado. Nenhuma mensagem será enviada.');
        await enviarMensagens(null, sender, testMode);
        sender.send('log', 'Modo de teste concluído. Bot permanecerá ativo para novas requisições.');
    } else {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info');
        sender.send('log', `[DEBUG] Estado de autenticação carregado: ${JSON.stringify(state)}`);

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            connectTimeoutMs: 30000, // Timeout de 30 segundos para conexão
            keepAliveIntervalMs: 30000, // Envia keep-alive a cada 30 segundos
            defaultQueryTimeoutMs: 60000, // Timeout para queries
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                const qrCodeUrl = await qrcode.toDataURL(qr);
                sender.send('log', qrCodeUrl);
            }

            if (connection === 'open') {
                sender.send('log', '✅ Conectado ao WhatsApp!');
                await enviarMensagens(sock, sender, testMode);
            } else if (connection === 'close') {
                const errorMessage = lastDisconnect?.error?.message || 'Motivo desconhecido';
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                sender.send('log', `❌ Conexão fechada! Motivo: ${errorMessage} (Status Code: ${statusCode})`);

                if (statusCode === DisconnectReason.loggedOut) {
                    sender.send('log', '❌ Usuário deslogado! Sessão expirada. Use o botão "Limpar Sessão" para gerar um novo QR Code.');
                    await clearSession(); // Limpa automaticamente o auth_info
                    isRunning = false;
                    botRunning = false;
                } else {
                    sender.send('log', 'Tentando reconectar em 5 segundos...');
                    setTimeout(() => {
                        if (isRunning) startBot(sender, testMode);
                    }, 5000);
                }
            }
        });
    }
}

function stopBot() {
    if (sock) {
        sock.end();
        sock = null;
    }
    isRunning = false;
    botRunning = false;
    sendLog('Bot parado manualmente.');
}

async function clearSession() {
    try {
        await fs.rm('auth_info', { recursive: true, force: true });
        sendLog('Diretório auth_info limpo com sucesso. Pronto para gerar um novo QR Code.');
    } catch (error) {
        sendLog(`⚠️ Erro ao limpar o diretório auth_info: ${error.message}`);
    }
}

function formatarNumeroTelefone(numero) {
    let numeroLimpo = numero.replace(/\D/g, '');
    console.log(`[DEBUG] Número limpo: ${numeroLimpo}`);

    if (numeroLimpo.startsWith('55') && numeroLimpo.length >= 11) {
        const ddd = numeroLimpo.substring(2, 4);
        const telefone = numeroLimpo.substring(4);
        if (telefone.length === 9 && telefone.startsWith('9')) {
            const parte1 = telefone.substring(0, 4);
            const parte2 = telefone.substring(4);
            const numeroFormatado = `+55 ${ddd} ${parte1}-${parte2}`;
            const numeroParaEnvio = numeroLimpo;
            return { numeroFormatado, numeroParaEnvio };
        }
    }

    if (numeroLimpo.length === 10 || numeroLimpo.length === 11) {
        if (numeroLimpo.length === 10 && !numeroLimpo.startsWith('0')) {
            numeroLimpo = '55' + numeroLimpo;
        } else if (numeroLimpo.length === 11 && !numeroLimpo.startsWith('55')) {
            numeroLimpo = '55' + numeroLimpo.substring(1);
        }
        const ddd = numeroLimpo.substring(2, 4);
        const telefone = numeroLimpo.substring(4);
        if (telefone.length === 9 && telefone.startsWith('9')) {
            const parte1 = telefone.substring(0, 4);
            const parte2 = telefone.substring(4);
            const numeroFormatado = `+55 ${ddd} ${parte1}-${parte2}`;
            const numeroParaEnvio = numeroLimpo;
            return { numeroFormatado, numeroParaEnvio };
        }
    }

    console.warn(`⚠️ Número inválido: ${numero}`);
    return { numeroFormatado: null, numeroParaEnvio: null };
}

function extrairPrimeiroNome(nomeCompleto) {
    if (!nomeCompleto || typeof nomeCompleto !== 'string') return '';
    const partes = nomeCompleto.trim().split(' ');
    const primeiroNome = partes[0] || '';
    return primeiroNome ? primeiroNome.charAt(0).toUpperCase() + primeiroNome.slice(1).toLowerCase() : '';
}

function extrairNomeDoEmail(email) {
    if (!email || typeof email !== 'string') return '';
    const partes = email.split('@');
    if (partes.length < 2) return '';
    let nomeParte = partes[0];
    let nomes = [];
    if (nomeParte.includes('.')) nomes = nomeParte.split('.');
    else if (nomeParte.includes('_')) nomes = nomeParte.split('_');
    else {
        const regex = /([a-z])([A-Z])/g;
        nomeParte = nomeParte.replace(regex, '$1 $2');
        nomes = nomeParte.split(/(\s+)/).filter(part => part.trim().length > 0);
        if (nomes.length === 1) {
            const match = nomeParte.match(/([a-z]+)([A-Z][a-z]+)/);
            if (match) nomes = [match[1], match[2].toLowerCase()];
        }
    }
    return nomes.map(nome => nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase()).filter(nome => nome).join(' ');
}

async function carregarContatos(sender) {
    const contatosPorDia = {};
    try {
        const alunos = await fetchEnrolled();
        for (const aluno of alunos) {
            const status = aluno.status || '';
            if (!['Ativo', 'EmRecuperacao', 'Atencao'].includes(status)) {
                sender.send('log', `⚠️ Aluno ignorado (status não permitido): ${aluno.nomeCompleto || 'Nome não disponível'} - Status: ${status}`);
                continue;
            }
            const nomeCompleto = aluno.nomeCompleto || '';
            const primeiroNome = extrairPrimeiroNome(nomeCompleto);
            const monitoringDay = aluno.monitoringDay || '';
            const agenteDoSucessoEmail = aluno.agenteDoSucesso || '';
            const agenteDoSucesso = extrairNomeDoEmail(agenteDoSucessoEmail);
            const numero = aluno.cel ? aluno.cel.replace(/\D/g, '') : '';
            const monitoringLink = aluno.monitoringLink || '';

            const [dia] = monitoringDay.split(' às ').map(str => str.trim());
            const diaNormalizado = dia ? dia.toLowerCase().replace('feira', '').trim() : '';

            const { numeroFormatado, numeroParaEnvio } = formatarNumeroTelefone(numero);
            if (!primeiroNome || !numeroFormatado || !numeroParaEnvio || !diaNormalizado || !monitoringLink) {
                sender.send('log', `⚠️ Dados incompletos para o aluno: ${JSON.stringify(aluno)}`);
                continue;
            }
            if (!contatosPorDia[diaNormalizado]) contatosPorDia[diaNormalizado] = [];
            contatosPorDia[diaNormalizado].push({
                numero: numeroParaEnvio,
                numeroFormatado,
                nome: primeiroNome,
                nomeCompleto,
                monitoringDay,
                agenteDoSucesso,
                monitoringLink,
            });
        }
        return contatosPorDia;
    } catch (error) {
        sender.send('log', `⚠️ Erro ao processar contatos: ${error.message}`);
        throw error;
    }
}

async function enviarMensagens(sock, sender, TEST_MODE) {
    if (!isRunning) return;

    const contatos = await carregarContatos(sender);
    const hoje = new Date().toLocaleString('pt-BR', { weekday: 'long' }).toLowerCase().replace('feira', '').replace('-', '').trim();
    sender.send('log', `Hoje é: ${hoje}`);

    if (contatos[hoje]) {
        sender.send('log', `Enviando mensagens para ${contatos[hoje].length} contatos com intervalo de 20 segundos...`);
        for (let i = 0; i < contatos[hoje].length && isRunning; i++) {
            const contato = contatos[hoje][i];
            const { numero, numeroFormatado, nome, monitoringDay, agenteDoSucesso, monitoringLink } = contato;
            const numeroWhatsApp = `${numero}@s.whatsapp.net`;
            const mensagem = `Olá ${nome}! 🚀 Passando aqui para lembrar sobre o atendimento semanal obrigatório com o Agente de Sucesso ${agenteDoSucesso}, ${monitoringDay}. Posso contar com a sua presença? 👇👇\n${monitoringLink}`;

            if (TEST_MODE) {
                sender.send('log', `[TESTE] Mensagem que seria enviada para ${numeroFormatado} (${nome}): "${mensagem}"`);
            } else {
                try {
                    await sock.sendMessage(numeroWhatsApp, { text: mensagem });
                    sender.send('log', `Mensagem enviada para ${numeroFormatado} (${nome})`);
                } catch (error) {
                    sender.send('log', `⚠️ Erro ao enviar mensagem para ${numeroFormatado}: ${error.message}`);
                }
            }

            if (i < contatos[hoje].length - 1 && isRunning) {
                sender.send('log', `Aguardando 20 segundos antes de enviar a próxima mensagem...`);
                await delay(20000);
            }
        }
        if (isRunning) {
            sender.send('log', 'Todas as mensagens foram enviadas!');
        }
    } else {
        sender.send('log', 'Nenhum contato para enviar hoje. Bot permanecerá ativo.');
    }
}

app.post('/start-bot', (req, res) => {
    if (botRunning) {
        return res.status(400).json({ message: 'Bot já está em execução!' });
    }
    testMode = req.body.testMode !== undefined ? req.body.testMode : true;
    botRunning = true;
    startBot({ send: (type, message) => sendLog(message) }, testMode);
    res.json({ message: 'Bot iniciado.' });
});

app.post('/stop-bot', (req, res) => {
    if (!botRunning) {
        return res.status(400).json({ message: 'Bot não está em execução!' });
    }
    stopBot();
    res.json({ message: 'Bot parado.' });
});

app.get('/status', (req, res) => {
    res.json({ running: botRunning, testMode });
});

app.post('/clear-session', async (req, res) => {
    if (botRunning) {
        stopBot();
    }
    await clearSession();
    res.json({ message: 'Sessão limpa. Inicie o bot novamente para gerar um novo QR Code.' });
});

process.on('uncaughtException', (error) => {
    console.error('Erro não tratado.Concurrent', error);
    sendLog(`Erro não tratado: ${error.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Rejeição não tratada:', reason);
    sendLog(`Rejeição não tratada: ${reason.message}`);
});