import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
    Box,
    Typography,
    Button,
    Paper,
    Divider,
    CircularProgress,
} from '@mui/material';

import logo from '../assets/logo-horizontal-texto-preto.png'; 

function BotInterface() {
    const [logs, setLogs] = useState([]);
    const [isBotRunning, setIsBotRunning] = useState(false);
    const [qrCode, setQrCode] = useState(null);
    const [isStarting, setIsStarting] = useState(false);
    const [isStopping, setIsStopping] = useState(false);
    const [isClearing, setIsClearing] = useState(false);
    const logAreaRef = useRef(null);
    const wsRef = useRef(null);

    const API_URL = 'http://localhost:5000';

    const fetchStatus = async () => {
        try {
            const response = await axios.get(`${API_URL}/status`);
            setIsBotRunning(response.data.running);
        } catch (error) {
            console.error('Erro ao verificar status:', error);
            setLogs((prevLogs) => [...prevLogs, `Erro ao verificar status: ${error.message}`]);
        }
    };

    const connectWebSocket = () => {
        try {
            const ws = new WebSocket('ws://localhost:5000');
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
                            setLogs((prevLogs) => [...prevLogs, data.message]);
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
        fetchStatus();
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

    const handleLogout = () => {
        localStorage.removeItem('isAuthenticated');
        window.location.href = '/login';
    };

    return (
        <Box sx={{ maxWidth: 800, mx: 'auto', p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                    <img
                        src={logo}
                        alt="Projeto Desenvolve Logo"
                        style={{
                            maxWidth: '220px',
                            height: 'auto',
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

            <Paper sx={{ p: 2, maxHeight: 400, overflowY: 'auto' }} ref={logAreaRef}>
                <Typography variant="h6">Logs</Typography>
                <Divider sx={{ mb: 2 }} />
                {logs.map((log, index) => (
                    <Typography key={index} variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {log}
                    </Typography>
                ))}
            </Paper>
        </Box>
    );
}

export default BotInterface;