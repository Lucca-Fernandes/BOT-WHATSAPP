// bot.js
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
require('dotenv').config();
const { fetchEnrolled } = require('./services/api');

// Modo de teste: true para simular, false para enviar mensagens reais
const TEST_MODE = process.env.TEST_MODE === 'true' || true; // Defina como true para testes

// Função para criar um atraso (em milissegundos)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function conectarWhatsApp() {
    if (TEST_MODE) {
        console.log('🚀 Modo de teste ativado. Nenhuma mensagem será enviada.');
        await enviarMensagens(null); // Chama enviarMensagens sem conectar ao WhatsApp
        return;
    }

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

    // Verificar se o número está no formato esperado (55 + DDD + 9 dígitos)
    if (numeroLimpo.length !== 13 || !numeroLimpo.startsWith('55')) {
        console.warn(`⚠️ Número inválido: ${numero}`);
        return { numeroFormatado: null, numeroParaEnvio: null };
    }

    // Extrair o DDD (2 dígitos após o 55)
    const ddd = numeroLimpo.substring(2, 4); // Ex.: "31"

    // Extrair o número de telefone (9 dígitos após o DDD)
    const telefone = numeroLimpo.substring(4); // Ex.: "989128267"

    // Remover o primeiro "9" do número de telefone
    if (telefone.startsWith('9')) {
        const telefoneSemNove = telefone.substring(1); // Ex.: "89128267"

        // Verificar se o número resultante tem 8 dígitos
        if (telefoneSemNove.length !== 8) {
            console.warn(`⚠️ Número inválido após remover o 9: ${numero}`);
            return { numeroFormatado: null, numeroParaEnvio: null };
        }

        // Formatar o número para exibição no padrão +55 xx xxxx-xxxx
        const parte1 = telefoneSemNove.substring(0, 4); // Ex.: "8912"
        const parte2 = telefoneSemNove.substring(4); // Ex.: "8267"
        const numeroFormatado = `+55 ${ddd} ${parte1}-${parte2}`; // Ex.: "+55 31 8912-8267"

        // Formatar o número para envio no WhatsApp (55 + DDD + 8 dígitos)
        const numeroParaEnvio = `55${ddd}${telefoneSemNove}`; // Ex.: "553189128267"

        return { numeroFormatado, numeroParaEnvio };
    } else {
        console.warn(`⚠️ Número não começa com 9: ${numero}`);
        return { numeroFormatado: null, numeroParaEnvio: null };
    }
}

// Função para extrair e formatar o primeiro nome do aluno
function extrairPrimeiroNome(nomeCompleto) {
    if (!nomeCompleto || typeof nomeCompleto !== 'string') {
        return '';
    }
    // Divide o nome completo por espaços e pega a primeira parte
    const partes = nomeCompleto.trim().split(' ');
    const primeiroNome = partes[0] || '';
    // Capitaliza apenas a primeira letra e deixa o resto em minúsculas
    if (primeiroNome) {
        return primeiroNome.charAt(0).toUpperCase() + primeiroNome.slice(1).toLowerCase();
    }
    return '';
}

// Função para extrair o nome do agente de sucesso a partir do e-mail
function extrairNomeDoEmail(email) {
    if (!email || typeof email !== 'string') {
        console.warn(`⚠️ E-mail do agente de sucesso vazio ou inválido: ${email}`);
        return '';
    }

    // Extrai a parte antes do "@"
    const partes = email.split('@');
    if (partes.length < 2) {
        console.warn(`⚠️ E-mail inválido para agente de sucesso: ${email}`);
        return '';
    }
    let nomeParte = partes[0]; // Ex.: "lucas.garcia" ou "lucasgarcia"
    console.log(`[DEBUG] Parte do nome extraída do e-mail: ${nomeParte}`);

    // Tenta dividir por "." ou "_"
    let nomes = [];
    if (nomeParte.includes('.')) {
        nomes = nomeParte.split('.'); // Ex.: "lucas.garcia" -> ["lucas", "garcia"]
    } else if (nomeParte.includes('_')) {
        nomes = nomeParte.split('_'); // Ex.: "lucas_garcia" -> ["lucas", "garcia"]
    } else {
        // Se não houver separadores, tenta dividir com base em transições de letras
        // Ex.: "lucasgarcia" -> ["lucas", "garcia"]
        const regex = /([a-z])([A-Z])/g;
        nomeParte = nomeParte.replace(regex, '$1 $2'); // Adiciona espaço antes de letras maiúsculas
        nomes = nomeParte.split(/(\s+)/).filter(part => part.trim().length > 0);
        if (nomes.length === 1) {
            // Se ainda for uma única parte, tenta dividir assumindo que é "primeiroNomeSobrenome"
            const match = nomeParte.match(/([a-z]+)([A-Z][a-z]+)/);
            if (match) {
                nomes = [match[1], match[2].toLowerCase()]; // Ex.: "lucasgarcia" -> ["lucas", "garcia"]
            }
        }
    }

    console.log(`[DEBUG] Nomes após split: ${JSON.stringify(nomes)}`);

    if (nomes.length === 0) {
        console.warn(`⚠️ Nome inválido no e-mail do agente de sucesso: ${email}`);
        return '';
    }

    // Capitaliza cada parte e junta com espaço
    const nomeFormatado = nomes
        .map(nome => {
            if (!nome) return '';
            return nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase();
        })
        .filter(nome => nome) // Remove partes vazias
        .join(' '); // Ex.: "Lucas Garcia"

    console.log(`[DEBUG] Nome formatado do agente: ${nomeFormatado}`);
    return nomeFormatado;
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
            const nomeCompleto = aluno.nomeCompleto || '';
            const primeiroNome = extrairPrimeiroNome(nomeCompleto); // Extrair o primeiro nome do aluno
            const monitoringDay = aluno.monitoringDay || ''; // Ex.: "Terça às 09:30"
            const agenteDoSucessoEmail = aluno.agenteDoSucesso || ''; // Ex.: "lucas.garcia@projetodesenvolve.com.br"
            const agenteDoSucesso = extrairNomeDoEmail(agenteDoSucessoEmail); // Ex.: "Lucas Garcia"
            const numero = aluno.cel ? aluno.cel.replace(/\D/g, '') : '';

            // Extrair o dia e o horário de monitoringDay
            const [dia, horario] = monitoringDay.split(' às ').map(str => str.trim());
            const diaNormalizado = dia ? dia.toLowerCase().replace('feira', '').trim() : '';

            // Formatar o número de telefone
            const { numeroFormatado, numeroParaEnvio } = formatarNumeroTelefone(numero);

            if (!diaNormalizado || !numeroFormatado || !numeroParaEnvio || !primeiroNome || !horario || !agenteDoSucesso) {
                console.warn(`⚠️ Dados incompletos para o aluno: ${JSON.stringify(aluno)}`);
                continue;
            }

            if (!contatosPorDia[diaNormalizado]) {
                contatosPorDia[diaNormalizado] = [];
            }

            // Armazenar o primeiro nome, nome completo e agenteDoSucesso
            contatosPorDia[diaNormalizado].push({
                numero: numeroParaEnvio,
                numeroFormatado,
                nome: primeiroNome,
                nomeCompleto,
                monitoringDay,
                agenteDoSucesso
            });
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
        console.log(`Enviando mensagens para ${contatos[hoje].length} contatos com intervalo de 20 segundos...`);
        for (let i = 0; i < contatos[hoje].length; i++) {
            const contato = contatos[hoje][i];
            const { numero, numeroFormatado, nome, nomeCompleto, monitoringDay, agenteDoSucesso } = contato;
            const numeroWhatsApp = `${numero}@s.whatsapp.net`;

            // Mensagem padrão com o nome do agente de sucesso
            const mensagem = `Olá ${nome}! 🚀 Passando aqui para lembrar sobre o atendimento semanal obrigatório com o Agente de Sucesso ${agenteDoSucesso}, ${monitoringDay}. Posso contar com a sua presença?`;

            if (TEST_MODE) {
                // Simular o envio (apenas exibir no log)
                console.log(`[TESTE] Mensagem que seria enviada para ${numeroFormatado} (${nomeCompleto}): "${mensagem}"`);
            } else {
                // Envio real
                try {
                    await sock.sendMessage(numeroWhatsApp, { text: mensagem });
                    console.log(`Mensagem enviada para ${numeroFormatado} (${nomeCompleto})`);
                } catch (error) {
                    console.error(`⚠️ Erro ao enviar mensagem para ${numeroFormatado} (${nomeCompleto}):`, error);
                }
            }

            // Adiciona um intervalo de 20 segundos entre os envios (exceto para o último contato)
            if (i < contatos[hoje].length - 1) {
                console.log(`Aguardando 20 segundos antes de enviar a próxima mensagem...`);
                await delay(20000); // 20 segundos
            }
        }
        console.log('Todas as mensagens foram enviadas!');
    } else {
        console.log("Nenhum contato para enviar hoje.");
    }
}

conectarWhatsApp();