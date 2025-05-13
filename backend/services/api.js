
const axios = require('axios');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const API_URL = process.env.API_URL || 'https://form.pdinfinita.com.br';
const API_KEY = process.env.API_KEY || 'Rm9ybUFwaUZlaXRhUGVsb0plYW5QaWVycmVQYXJhYURlc2Vudm9sdmU=';

console.log('API_URL:', API_URL);
console.log('API_KEY:', API_KEY);

const api = axios.create({
    baseURL: API_URL,
    headers: {
        'api-key': API_KEY, 
    },
});

async function fetchEnrolled() {
    try {
        const response = await api.get('/enrolled');
        console.log('Resposta da API:', response.data);
        return response.data;
    } catch (error) {
        console.error('Erro na API:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Dados do erro:', error.response.data);
        }
        throw error;
    }
}

if (require.main === module) {
    fetchEnrolled();
}

module.exports = { fetchEnrolled };