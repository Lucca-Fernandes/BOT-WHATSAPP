const axios = require('axios');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const API_URL = process.env.API_URL 
const API_KEY = process.env.API_KEY

const api = axios.create({
    baseURL: API_URL,
    headers: {
        'api-key': API_KEY, 
    },
});

async function fetchEnrolled() {
    try {
        const response = await api.get('/enrolled');
        return response.data;
    } catch (error) {
        // Em produção, erros devem ser tratados silenciosamente ou logados em um sistema de logging adequado
        // Aqui apenas relançamos o erro para que o chamador possa decidir o que fazer
        throw error;
    }
}

if (require.main === module) {
    fetchEnrolled().catch(err => {
        // Se o arquivo for executado diretamente (ex: node services/api.js), ainda capturamos o erro
        // sem imprimir detalhes sensíveis no console
        process.exit(1);
    });
}

module.exports = { fetchEnrolled };