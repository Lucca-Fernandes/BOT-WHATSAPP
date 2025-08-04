Projeto de Bot do WhatsApp
Um backend robusto e automatizado para gerenciar e enviar lembretes do WhatsApp a estudantes, utilizando Node.js e PostgreSQL.

🌟 Visão Geral do Projeto
Este projeto é um serviço de backend inteligente, projetado para simplificar a comunicação de lembretes de monitoria para estudantes através do WhatsApp. Ele se integra perfeitamente com a API do WhatsApp usando a biblioteca @whiskeysockets/baileys, armazena estatísticas e dados de contato em um banco de dados PostgreSQL e se comunica em tempo real com uma interface de frontend através de WebSockets.

O bot lida com o ciclo completo de envio de lembretes: valida os contatos dos estudantes, envia as mensagens nos horários agendados e registra o sucesso ou falha de cada envio.

✨ Funcionalidades Principais
Automação de Lembretes: Envio automático de mensagens do WhatsApp para estudantes, com base em horários e dias de monitoria definidos.

Gerenciamento de Sessão: Inicie, pare ou limpe a sessão do WhatsApp facilmente, com autenticação via QR code.

Validação de Contato: Verificação automática de números de telefone, e-mails de agentes e links de monitoria, registrando dados inválidos para correção.

Rastreamento de Estatísticas: Registra o número de mensagens enviadas por dia e por agente, fornecendo dados importantes para análise.

Comunicação em Tempo Real: Usa WebSockets para enviar logs e atualizações de status ao vivo para a interface do frontend.

Autenticação Segura: Protege os endpoints da API com autenticação baseada em sessão para acesso administrativo.

🚀 Tecnologias Utilizadas
Node.js: Ambiente de execução principal.

@whiskeysockets/baileys: Biblioteca para integração com o WhatsApp.

PostgreSQL: Banco de dados relacional para persistência de dados.

WebSockets: Para comunicação em tempo real com o frontend.

🛠️ Instalação e Configuração
1. Pré-requisitos
Certifique-se de ter instalado:

Node.js (versão 14.x ou superior)

PostgreSQL (versão 12.x ou superior)

Git

2. Passo a Passo
Clone o repositório:

git clone https://github.com/your-username/whatsapp-bot.git
cd whatsapp-bot

Instale as dependências:

npm install

Configure o Banco de Dados:

Crie um banco de dados PostgreSQL. O nome padrão usado no projeto é bot_progress.

O aplicativo criará as tabelas sent_messages e stats automaticamente na primeira execução.

Configure as Variáveis de Ambiente:

Crie um arquivo .env na raiz do projeto.

Preencha-o com as suas configurações:

DATABASE_URL=postgres://username:password@localhost:5432/bot_progress
PORT=5000
FRONTEND_URL=http://localhost:3000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=123456

Execute a Aplicação:

npm start

O servidor estará disponível em http://localhost:5000 (ou na porta que você definiu).

💡 Uso da API
O bot é controlado através dos seguintes endpoints. A maioria requer autenticação via sessionKey após um login bem-sucedido.

POST /login: Autentica o administrador e retorna a chave de sessão.

POST /start-bot: Inicia o bot e gera o QR code para conexão.

POST /stop-bot: Para a execução do bot e a conexão com o WhatsApp.

POST /clear-session: Limpa a sessão atual para gerar um novo QR code.

GET /status: Verifica o estado atual do bot (conectado, desconectado, etc.).

GET /stats: Retorna estatísticas de mensagens enviadas por dia e por agente.

GET /contact-logs: Retorna uma lista de contatos que apresentaram erro de validação.

GET /search-students?name=...: Busca estudantes por nome.

📂 Estrutura de Arquivos
whatsapp-bot/
├── auth_info/           # Arquivos de autenticação do Baileys
├── node_modules/        # Dependências do Node.js
├── services/            # Serviços de API externas (ex: fetchEnrolled)
│   └── api.js
├── .env                 # Variáveis de ambiente
├── package.json         # Metadados do projeto
└── index.js             # Arquivo principal da aplicação

⚠️ Solução de Problemas
QR Code não aparece?

Limpe a sessão atual (/clear-session) e reinicie o bot (/start-bot).

Bot desconecta ou não conecta?

Verifique sua conexão com a internet.

Atualize a biblioteca baileys: npm install @whiskeysockets/baileys@latest.

Confirme se a DATABASE_URL no arquivo .env está correta.

Verifique se o seu servidor PostgreSQL está em execução.

📜 Licença
Este projeto está sob a licença MIT. Para mais detalhes, consulte o arquivo LICENSE.

✉️ Contato
Para qualquer dúvida, abra uma issue no repositório do GitHub.
