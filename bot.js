// bot.js
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
require('dotenv').config();
const { fetchEnrolled } = require('./services/api');

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
            console.log("Escaneie este QR Code para conectar:");
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log('✅ Conectado ao WhatsApp!');
            await enviarMensagens(sock);
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

// Função para formatar o número de telefone
function formatarNumeroTelefone(numero) {
    // Remover todos os caracteres não numéricos
    const numeroLimpo = numero.replace(/\D/g, '');

    // Verificar se o número está no formato esperado 
    if (numeroLimpo.length !== 13 || !numeroLimpo.startsWith('55')) {
        console.warn(`⚠️ Número inválido: ${numero}`);
        return { numeroFormatado: null, numeroParaEnvio: null };
    }

    // Extrair o DDD 
    const ddd = numeroLimpo.substring(2, 4); 

    // Extrair o número de telefone 
    const telefone = numeroLimpo.substring(4); 

    // Remover o primeiro "9" do número de telefone
    if (telefone.startsWith('9')) {
        const telefoneSemNove = telefone.substring(1); 

        // Verificar se o número resultante tem 8 dígitos
        if (telefoneSemNove.length !== 8) {
            console.warn(`⚠️ Número inválido após remover o 9: ${numero}`);
            return { numeroFormatado: null, numeroParaEnvio: null };
        }

        // Formatar o número para exibição no padrão +55 xx xxxx-xxxx
        const parte1 = telefoneSemNove.substring(0, 4); 
        const parte2 = telefoneSemNove.substring(4); 
        const numeroFormatado = `+55 ${ddd} ${parte1}-${parte2}`; 

        // Formatar o número para envio no WhatsApp 
        const numeroParaEnvio = `55${ddd}${telefoneSemNove}`; 

        return { numeroFormatado, numeroParaEnvio };
    } else {
        console.warn(`⚠️ Número não começa com 9: ${numero}`);
        return { numeroFormatado: null, numeroParaEnvio: null };
    }
}

async function carregarContatos() {
    const contatosPorDia = {};

    try {
        const alunos = await fetchEnrolled();

        for (const aluno of alunos) {
            // Verificar o status do aluno
            const status = aluno.status || '';
            const statusPermitidos = ['Ativo', 'EmRecuperacao', 'Atencao'];

            if (!statusPermitidos.includes(status)) {
                console.warn(`⚠️ Aluno ignorado (status não permitido): ${aluno.nomeCompleto || 'Nome não disponível'} - Status: ${status}`);
                continue;
            }

            // Mapear os campos da API para os esperados
            const nome = aluno.nomeCompleto || '';
            const monitoringDay = aluno.monitoringDay || ''; 
            const numero = aluno.cel ? aluno.cel.replace(/\D/g, '') : '';

            // Extrair o dia e o horário de monitoringDay
            const [dia, horario] = monitoringDay.split(' às ').map(str => str.trim());
            const diaNormalizado = dia ? dia.toLowerCase().replace('feira', '').trim() : '';

            // Formatar o número de telefone
            const { numeroFormatado, numeroParaEnvio } = formatarNumeroTelefone(numero);

            if (!diaNormalizado || !numeroFormatado || !numeroParaEnvio || !nome || !horario) {
                console.warn(`⚠️ Dados incompletos para o aluno: ${JSON.stringify(aluno)}`);
                continue;
            }

            if (!contatosPorDia[diaNormalizado]) {
                contatosPorDia[diaNormalizado] = [];
            }

            contatosPorDia[diaNormalizado].push({ numero: numeroParaEnvio, numeroFormatado, nome, monitoringDay });
        }

        return contatosPorDia;
    } catch (error) {
        console.error('⚠️ Erro ao processar contatos:', error.message);
        throw error;
    }
}

async function enviarMensagens(sock) {
    const contatos = await carregarContatos();

    const hoje = new Date().toLocaleString('pt-BR', { weekday: 'long' }).toLowerCase().replace('feira', '').replace('-', '').trim();

    console.log(`Hoje é: ${hoje}`);

    if (contatos[hoje]) {
        for (const contato of contatos[hoje]) {
            const { numero, numeroFormatado, nome, monitoringDay } = contato;
            const numeroWhatsApp = `${numero}@s.whatsapp.net`;

            const mensagem = `Olá ${nome}, passando para lembrar que nossa reunião semanal obrigatória é hoje, ${monitoringDay}.`;

            try {
                await sock.sendMessage(numeroWhatsApp, { text: mensagem });
                console.log(`Mensagem enviada para ${numeroFormatado} (${nome})`);
            } catch (error) {
                console.error(`⚠️ Erro ao enviar mensagem para ${numeroFormatado} (${nome}):`, error);
            }
        }
    } else {
        console.log("Nenhum contato para enviar hoje.");
    }
}

conectarWhatsApp();