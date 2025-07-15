import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
    Box,
    Typography,
    Button,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Collapse,
} from '@mui/material';

function ContactLogs() {
    const [logs, setLogs] = useState([]);
    const [groupedLogs, setGroupedLogs] = useState({});
    const [selectedAgent, setSelectedAgent] = useState(null);

    const API_URL = 'https://bot-whatsapp-1-yu8c.onrender.com';

    // Função para buscar os logs da API
    const fetchLogs = async () => {
        try {
            const response = await axios.get(`${API_URL}/contact-logs`);
            setLogs(response.data);
        } catch (error) {
            console.error('Erro ao buscar logs:', error);
            setLogs([]);
        }
    };

    // Agrupar logs por agente
    const groupLogsByAgent = (logs) => {
        const grouped = {};
        logs.forEach((log) => {
            const agent = log.agent;
            if (!grouped[agent]) {
                grouped[agent] = [];
            }
            grouped[agent].push(log);
        });
        return grouped;
    };

    // Buscar logs ao montar o componente
    useEffect(() => {
        fetchLogs();
    }, []);

    // Agrupar logs sempre que os logs mudarem
    useEffect(() => {
        const grouped = groupLogsByAgent(logs);
        setGroupedLogs(grouped);
    }, [logs]);

    // Função para lidar com o clique em um agente
    const handleAgentClick = (agent) => {
        setSelectedAgent(selectedAgent === agent ? null : agent);
    };

    return (
        <Box sx={{ maxWidth: 800, mx: 'auto', p: 3, backgroundColor: '#000000', minHeight: '100vh' }}>
            <Typography variant="h4" sx={{ color: 'white', textAlign: 'center', mb: 3 }}>
                Logs de Alunos Não Contatados
            </Typography>

            {/* Lista de agentes */}
            <Box sx={{ mb: 3 }}>
                {Object.keys(groupedLogs).map((agent) => (
                    <Box key={agent} sx={{ mb: 1 }}>
                        <Button
                            variant="contained"
                            color="primary"
                            onClick={() => handleAgentClick(agent)}
                            sx={{ width: '100%', textAlign: 'left' }}
                        >
                            {agent} ({groupedLogs[agent].length} alunos)
                        </Button>
                        <Collapse in={selectedAgent === agent}>
                            <TableContainer component={Paper} sx={{ mt: 1 }}>
                                <Table>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Aluno</TableCell>
                                            <TableCell>Registration Code</TableCell>
                                            <TableCell>Motivo</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {groupedLogs[agent].map((log, index) => (
                                            <TableRow key={index}>
                                                <TableCell>{log.student}</TableCell>
                                                <TableCell>{log.registrationCode}</TableCell>
                                                <TableCell>{log.reason}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Collapse>
                    </Box>
                ))}
            </Box>

            {Object.keys(groupedLogs).length === 0 && (
                <Typography variant="body1" sx={{ color: 'white', textAlign: 'center' }}>
                    Nenhum log encontrado.
                </Typography>
            )}
        </Box>
    );
}

export default ContactLogs;