import React, { useState, useEffect, useRef, Component } from 'react';
import { Box, Typography, Paper, Collapse, Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';

class ErrorBoundary extends Component {
    state = { hasError: false, error: null };

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    render() {
        if (this.state.hasError) {
            return (
                <Typography variant="body1" color="error">
                    Ocorreu um erro ao carregar as estatísticas: {this.state.error.message}
                </Typography>
            );
        }
        return this.props.children;
    }
}

function MessageStats() {
    const [stats, setStats] = useState({
        totalSent: 0,
        porDia: { segunda: 0, terça: 0, quarta: 0, quinta: 0, sexta: 0 },
        porAgente: { segunda: {}, terça: {}, quarta: {}, quinta: {}, sexta: {} },
    });
    const [expandedDays, setExpandedDays] = useState({});
    const [error, setError] = useState(null);
    const wsRef = useRef(null);
    const [openConfirmDialog, setOpenConfirmDialog] = useState(false);

    useEffect(() => {
        const sessionKey = localStorage.getItem('sessionKey');
        if (!sessionKey) {
            console.log('Nenhuma sessão ativa');
            setError('Nenhuma sessão ativa.');
            return;
        }

        const fetchInitialStats = async () => {
            try {
                const response = await fetch('https://bot-whatsapp-va5n.onrender.com/stats', {
                    method: 'GET',
                    headers: {
                        'x-session-key': sessionKey,
                    },
                });
                if (response.ok) {
                    const data = await response.json();
                    setStats(prev => ({
                        ...prev,
                        totalSent: data.totalSent || 0,
                        porDia: data.porDia || prev.porDia,
                        porAgente: data.porAgente || prev.porAgente,
                    }));
                } else {
                    setError('Falha ao carregar estatísticas iniciais.');
                }
            } catch (error) {
                console.error('Erro ao buscar estatísticas iniciais:', error);
                setError('Erro ao carregar estatísticas iniciais.');
            }
        };

        fetchInitialStats();

        const wsUrl = 'wss://bot-whatsapp-va5n.onrender.com';
        const ws = new WebSocket(`${wsUrl}?sessionKey=${sessionKey}`);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log('WebSocket conectado para estatísticas');
            setError(null);
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'log') {
                    console.log('Mensagem recebida:', data.message);
                    if (data.message.includes('Estatísticas do Envio')) {
                        const match = data.message.match(/Total Enviadas: (\d+)/);
                        if (match) {
                            setStats(prev => ({ ...prev, totalSent: parseInt(match[1], 10) }));
                            console.log('Total Enviadas atualizado:', parseInt(match[1], 10));
                        }
                    } else if (data.message.includes('Estatísticas por Dia')) {
                        const match = data.message.match(/Estatísticas por Dia - (\w+): Total Enviadas: (\d+)/);
                        if (match) {
                            const [, dia, total] = match;
                            setStats(prev => ({
                                ...prev,
                                porDia: { ...prev.porDia, [dia.toLowerCase()]: parseInt(total, 10) },
                            }));
                        }
                    } else if (data.message.startsWith('{"type":"agentStats"')) {
                        const agentStats = JSON.parse(data.message);
                        const { day, agents } = agentStats.data;
                        setStats(prev => ({
                            ...prev,
                            porAgente: {
                                ...prev.porAgente,
                                [day.toLowerCase()]: agents || {},
                            },
                        }));
                    }
                }
            } catch (error) {
                console.error('Erro ao processar mensagem de estatísticas:', error);
                setError('Falha ao processar mensagem de estatísticas.');
            }
        };

        ws.onclose = () => {
            console.log('WebSocket desconectado para estatísticas');
            setError('Conexão WebSocket desconectada.');
        };

        ws.onerror = (error) => {
            console.error('Erro no WebSocket para estatísticas:', error);
            setError('Erro na conexão WebSocket.');
        };

        const reconnect = setInterval(() => {
            if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
                console.log('Tentando reconectar ao WebSocket...');
                wsRef.current = new WebSocket(`${wsUrl}?sessionKey=${sessionKey}`);
                wsRef.current.onopen = ws.onopen;
                wsRef.current.onmessage = ws.onmessage;
                wsRef.current.onclose = ws.onclose;
                wsRef.current.onerror = ws.onerror;
            }
        }, 5000);

        return () => {
            clearInterval(reconnect);
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, []);

    const diasSemana = ['segunda', 'terça', 'quarta', 'quinta', 'sexta'];

    const handleDayToggle = (dia) => {
        setExpandedDays(prev => ({
            ...prev,
            [dia]: !prev[dia],
        }));
    };

    const handleClearStats = () => {
        setOpenConfirmDialog(true);
    };

    const confirmClearStats = async () => {
        const sessionKey = localStorage.getItem('sessionKey');
        if (!sessionKey) {
            setError('Nenhuma sessão ativa para limpar estatísticas.');
            setOpenConfirmDialog(false);
            return;
        }

        try {
            const response = await fetch('https://bot-whatsapp-va5n.onrender.com/reset-stats', {
                method: 'POST',
                headers: {
                    'x-session-key': sessionKey,
                },
            });
            if (response.ok) {
                setError(null);
                console.log('Estatísticas resetadas com sucesso. Aguardando atualização do WebSocket.');
            } else {
                setError('Falha ao resetar estatísticas.');
            }
        } catch (error) {
            console.error('Erro ao resetar estatísticas:', error);
            setError('Erro ao resetar estatísticas.');
        }
        setOpenConfirmDialog(false);
    };

    const cancelClearStats = () => {
        setOpenConfirmDialog(false);
    };

    return (
        <ErrorBoundary>
            <Paper sx={{ p: 2, mb: 3 }}>
                <Typography variant="h6">Estatísticas de Envio</Typography>
                {error ? (
                    <Typography variant="body1" color="error">{error}</Typography>
                ) : (
                    <>
                        <Typography variant="body1">Total Enviadas: {stats.totalSent}</Typography>
                        <Box sx={{ mt: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                            {diasSemana.map(dia => (
                                <Box key={dia} sx={{ p: 1, border: '1px solid #ccc', borderRadius: 1, minWidth: '150px' }}>
                                    <Box
                                        onClick={() => handleDayToggle(dia)}
                                        sx={{ cursor: 'pointer', p: 1, bgcolor: expandedDays[dia] ? '#f5f5f5' : 'inherit' }}
                                    >
                                        <Typography variant="subtitle1">{dia.charAt(0).toUpperCase() + dia.slice(1)}</Typography>
                                        <Typography variant="body2">Total Enviadas: {stats.porDia[dia]}</Typography>
                                    </Box>
                                    <Collapse in={expandedDays[dia]}>
                                        <Box sx={{ p: 1, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                                            {stats.porAgente[dia] && Object.keys(stats.porAgente[dia]).length > 0 ? (
                                                Object.entries(stats.porAgente[dia]).map(([agent, envios]) => (
                                                    <Box key={agent} sx={{ mt: 1 }}>
                                                        <Typography variant="body2">Agente: {agent}</Typography>
                                                        <Typography variant="body2">Envios: {envios}</Typography>
                                                    </Box>
                                                ))
                                            ) : (
                                                <Typography variant="body2">Por Agente: Nenhum dado disponível</Typography>
                                            )}
                                        </Box>
                                    </Collapse>
                                </Box>
                            ))}
                        </Box>
                        <Box sx={{ mt: 2 }}>
                            <Button
                                variant="contained"
                                color="error"
                                onClick={handleClearStats}
                                sx={{ mt: 1 }}
                            >
                                Resetar Estatísticas
                            </Button>
                        </Box>
                    </>
                )}
                <Dialog open={openConfirmDialog} onClose={cancelClearStats}>
                    <DialogTitle>Confirmar Reset</DialogTitle>
                    <DialogContent>
                        <Typography>Deseja realmente resetar todas as estatísticas? Isso limpará todos os dados do banco de dados.</Typography>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={cancelClearStats} color="primary">
                            Cancelar
                        </Button>
                        <Button onClick={confirmClearStats} color="error">
                            Confirmar
                        </Button>
                    </DialogActions>
                </Dialog>
            </Paper>
        </ErrorBoundary>
    );
}

export default MessageStats;