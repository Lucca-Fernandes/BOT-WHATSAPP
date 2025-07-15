import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
    Box,
    Typography,
    Button,
    Paper,
    Divider,
    CircularProgress,
    Table,
    TableContainer,
    TableHead,
    TableRow,
    TableCell,
    TableBody,
    Collapse,
} from '@mui/material';

import logo from '../assets/logo-horizontal-texto-preto.png';
import BuscarAluno from '../components/BuscarAluno';
import MessageStats from '../components/MessageStats';

function BotInterface() {
    const [logs, setLogs] = useState([]);
    const [isBotRunning, setIsBotRunning] = useState(false);
    const [qrCode, setQrCode] = useState(null);
    const [isStarting, setIsStarting] = useState(false);
    const [isStopping, setIsStopping] = useState(false);
    const [isClearing, setIsClearing] = useState(false);
    const [contactLogs, setContactLogs] = useState([]);
    const [groupedContactLogs, setGroupedContactLogs] = useState({});
    const [selectedAgent, setSelectedAgent] = useState(null);
    const [isLoadingContacts, setIsLoadingContacts] = useState(true);
    const [isInvalidContactsExpanded, setIsInvalidContactsExpanded] = useState(false);
    const logAreaRef = useRef(null);
    const wsRef = useRef(null);

    const API_URL = 'https://bot-whatsapp-1-yu8c.onrender.com';
    const WS_URL = 'wss://bot-whatsapp-1-yu8c.onrender.com';

    const setupAxiosInterceptors = () => {
        axios.interceptors.request.use(
            (config) => {
                const sessionKey = localStorage.getItem('sessionKey');
                if (sessionKey) {
                    config.headers['x-session-key'] = sessionKey;
                }
                return config;
            },
            (error) => Promise.reject(error)
        );

        axios.interceptors.response.use(
            (response) => response,
            (error) => {
                if (error.response?.status === 401) {
                    localStorage.removeItem('sessionKey');
                    localStorage.removeItem('isAuthenticated');
                    window.location.href = '/login';
                }
                return Promise.reject(error);
            }
        );
    };

    const fetchStatus = async () => {
        try {
            const response = await axios.get(`${API_URL}/status`);
            setIsBotRunning(response.data.running);
        } catch (error) {
            console.error('Erro ao verificar status:', error);
            setLogs((prevLogs) => [...prevLogs, `Erro ao verificar status: ${error.message}`]);
        }
    };

    const fetchContactLogs = async () => {
        setIsLoadingContacts(true);
        try {
            const response = await axios.get(`${API_URL}/contact-logs`);
            setContactLogs(response.data);
        } catch (error) {
            console.error('Erro ao buscar logs de contatos inválidos:', error);
            setContactLogs([]);
        } finally {
            setIsLoadingContacts(false);
        }
    };

    const groupContactLogsByAgent = (logs) => {
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

    const connectWebSocket = () => {
        try {
            const sessionKey = localStorage.getItem('sessionKey');
            if (!sessionKey) {
                window.location.href = '/login';
                return;
            }

            const ws = new WebSocket(`${WS_URL}?sessionKey=${sessionKey}`);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log('Conectado ao WebSocket');
                setLogs((prevLogs) => [...prevLogs, 'Conectado ao WebSocket']);
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'log') {
                        if (data.message.startsWith('data:image')) {
                            setQrCode(data.message);
                            setLogs((prevLogs) => [...prevLogs, 'QR Code recebido']);
                        } else {
                            if (!data.message.includes('Contato inválido')) {
                                setLogs((prevLogs) => [...prevLogs, data.message]);
                            }
                            if (data.message.includes('Bot parado')) {
                                setIsBotRunning(false);
                                setQrCode(null);
                            } else if (data.message.includes('Conectado ao WhatsApp')) {
                                setIsBotRunning(true);
                            }
                        }
                    }
                } catch (error) {
                    console.error('Erro ao processar mensagem do WebSocket:', error);
                    setLogs((prevLogs) => [...prevLogs, `Erro ao processar mensagem: ${error.message}`]);
                }
            };

            ws.onclose = () => {
                console.log('Desconectado do WebSocket');
                setLogs((prevLogs) => [...prevLogs, 'Desconectado do WebSocket']);
            };

            ws.onerror = (error) => {
                console.error('Erro no WebSocket:', error);
                setLogs((prevLogs) => [...prevLogs, `Erro no WebSocket: ${error.message || 'Erro desconhecido'}`]);
            };
        } catch (error) {
            console.error('Erro ao conectar ao WebSocket:', error);
            setLogs((prevLogs) => [...prevLogs, `Erro ao conectar ao WebSocket: ${error.message}`]);
        }
    };

    useEffect(() => {
        const isAuthenticated = localStorage.getItem('isAuthenticated');
        if (!isAuthenticated) {
            window.location.href = '/login';
            return;
        }

        setupAxiosInterceptors();
        fetchStatus();
        fetchContactLogs();
        connectWebSocket();

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, []);

    useEffect(() => {
        if (logAreaRef.current) {
            logAreaRef.current.scrollTop = logAreaRef.current.scrollHeight;
        }
    }, [logs]);

    useEffect(() => {
        const grouped = groupContactLogsByAgent(contactLogs);
        setGroupedContactLogs(grouped);
    }, [contactLogs]);

    const handleStartBot = async () => {
        setIsStarting(true);
        try {
            const response = await axios.post(`${API_URL}/start-bot`);
            setLogs((prevLogs) => [...prevLogs, 'Bot iniciado com sucesso']);
        } catch (error) {
            console.error('Erro ao iniciar o bot:', error);
            setLogs((prevLogs) => [...prevLogs, `Erro ao iniciar o bot: ${error.response?.data?.message || error.message}`]);
        } finally {
            setIsStarting(false);
            fetchStatus();
        }
    };

    const handleStopBot = async () => {
        if (isStopping) return;
        setIsStopping(true);
        try {
            const response = await axios.post(`${API_URL}/stop-bot`);
            setLogs((prevLogs) => [...prevLogs, 'Bot parado com sucesso']);
        } catch (error) {
            console.error('Erro ao parar o bot:', error);
            setLogs((prevLogs) => [...prevLogs, `Erro ao parar o bot: ${error.response?.data?.message || error.message}`]);
        } finally {
            setTimeout(() => {
                setIsStopping(false);
                fetchStatus();
            }, 1000);
        }
    };

    const handleClearLogs = () => {
        setLogs([]);
        setQrCode(null);
    };

    const handleClearSession = async () => {
        setIsClearing(true);
        try {
            const response = await axios.post(`${API_URL}/clear-session`);
            setQrCode(null);
            setLogs((prevLogs) => [...prevLogs, response.data.message]);
        } catch (error) {
            console.error('Erro ao limpar sessão:', error);
            setLogs((prevLogs) => [...prevLogs, `Erro ao limpar sessão: ${error.response?.data?.message || error.message}`]);
        } finally {
            setIsClearing(false);
            fetchStatus();
        }
    };

    const handleLogout = async () => {
        try {
            await axios.post(`${API_URL}/logout`);
            localStorage.removeItem('sessionKey');
            localStorage.removeItem('isAuthenticated');
            window.location.href = '/login';
        } catch (error) {
            console.error('Erro ao fazer logout:', error);
            setLogs((prevLogs) => [...prevLogs, `Erro ao fazer logout: ${error.message}`]);
        }
    };

    const handleAgentClick = (agent) => {
        setSelectedAgent(selectedAgent === agent ? null : agent);
    };

    const handleInvalidContactsToggle = () => {
        setIsInvalidContactsExpanded(!isInvalidContactsExpanded);
    };

    return (
        <Box sx={{ maxWidth: 800, mx: 'auto', p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                    <img
                        src={logo}
                        alt="Projeto Desenvolve Logo"
                        style={{
                            maxWidth: '240px',
                            height: 'auto',
                            marginBottom: '10px'
                        }}
                    />
                </Box>
                <Button
                    variant="contained"
                    color="error"
                    onClick={handleLogout}
                >
                    Sair
                </Button>
            </Box>

            <Box sx={{ display: 'flex', gap: 2, mb: 3, justifyContent: 'center' }}>
                <Button
                    variant="contained"
                    color="primary"
                    onClick={handleStartBot}
                    disabled={isBotRunning || isStarting || isStopping || isClearing}
                    startIcon={isStarting ? <CircularProgress size={20} /> : null}
                >
                    {isStarting ? 'Iniciando...' : 'Iniciar Bot'}
                </Button>
                <Button
                    variant="contained"
                    color="secondary"
                    onClick={handleStopBot}
                    disabled={!isBotRunning || isStarting || isStopping || isClearing}
                    startIcon={isStopping ? <CircularProgress size={20} /> : null}
                >
                    {isStopping ? 'Parando...' : 'Parar Bot'}
                </Button>
                <Button
                    variant="outlined"
                    color="#00000"
                    onClick={handleClearLogs}
                    disabled={isBotRunning || isStarting || isStopping || isClearing}
                >
                    Limpar Logs
                </Button>
                <Button
                    variant="outlined"
                    color="#00000"
                    onClick={handleClearSession}
                    disabled={isStarting || isStopping || isClearing}
                    startIcon={isClearing ? <CircularProgress size={20} /> : null}
                >
                    {isClearing ? 'Limpando...' : 'Limpar Sessão'}
                </Button>
            </Box>

            <Typography variant="body1" sx={{ textAlign: 'center', mb: 2 }}>
                Status: {isBotRunning ? 'Bot em execução' : 'Bot parado'}
            </Typography>

            {qrCode && (
                <Box sx={{ textAlign: 'center', mb: 3 }}>
                    <Typography variant="h6">Escaneie o QR Code:</Typography>
                    <img src={qrCode} alt="QR Code" style={{ maxWidth: 200, height: 'auto' }} />
                </Box>
            )}

            <Paper sx={{ p: 2, mb: 5, maxHeight: 400, overflowY: 'auto' }} ref={logAreaRef}>
                <Typography variant="h6">Logs</Typography>
                <Divider sx={{ mb: 2 }} />
                {logs.map((log, index) => (
                    <Typography key={index} variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {log}
                    </Typography>
                ))}
            </Paper>

            <BuscarAluno apiUrl={API_URL} />

            <Paper sx={{ p: 2, mb: 3 }}>
                <Box
                    onClick={handleInvalidContactsToggle}
                    sx={{ cursor: 'pointer', p: 1, bgcolor: isInvalidContactsExpanded ? '#f5f5f5' : 'inherit' }}
                >
                    <Typography variant="h6">Contatos Inválidos</Typography>
                </Box>
                <Collapse in={isInvalidContactsExpanded}>
                    <Divider sx={{ mb: 2 }} />
                    {isLoadingContacts ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                            <CircularProgress />
                        </Box>
                    ) : Object.keys(groupedContactLogs).length === 0 ? (
                        <Typography variant="body2">Nenhum contato inválido registrado.</Typography>
                    ) : (
                        Object.keys(groupedContactLogs).map((agent) => (
                            <Box key={agent} sx={{ mb: 2 }}>
                                <Button
                                    variant="contained"
                                    color="primary"
                                    onClick={() => handleAgentClick(agent)}
                                    sx={{ width: '100%', textAlign: 'left' }}
                                >
                                    {agent} ({groupedContactLogs[agent].length} contatos inválidos)
                                </Button>
                                <Collapse in={selectedAgent === agent}>
                                    <TableContainer sx={{ mt: 1 }}>
                                        <Table>
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell>Aluno</TableCell>
                                                    <TableCell>Registration Code</TableCell>
                                                    <TableCell>Motivo</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {groupedContactLogs[agent].map((log, index) => (
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
                        ))
                    )}
                </Collapse>
            </Paper>

            <MessageStats />
        </Box>
    );
}

export default BotInterface;