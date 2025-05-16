import React, { useState } from 'react';
import { TextField, Button, Box, Alert, CircularProgress } from '@mui/material';
import axios from 'axios';
import logo from '../assets/logo-horizontal-texto-preto.png';

function Login() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const API_URL = 'https://bot-whatsapp-rho.vercel.app';

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            const response = await axios.post(`${API_URL}/login`, {
                username,
                password,
            }, {
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            const { sessionKey } = response.data;
            localStorage.setItem('sessionKey', sessionKey);
            localStorage.setItem('isAuthenticated', 'true');
            window.location.href = '/bot';
        } catch (err) {
            setError(err.response?.data?.message || 'Erro ao fazer login');
            setIsLoading(false);
        }
    };

    return (
        <Box
            sx={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100vh',
                backgroundColor: '#f0f0f0',
            }}
        >
            <Box
                sx={{
                    width: 400,
                    p: 4,
                    backgroundColor: 'white',
                    borderRadius: 2,
                    boxShadow: 3,
                    textAlign: 'center',
                }}
            >
                <img
                    src={logo}
                    alt="Logo"
                    style={{
                        maxWidth: '230px',
                        marginBottom: '16px',
                    }}
                />
                <form onSubmit={handleSubmit}>
                    <TextField
                        label="Usuário"
                        variant="outlined"
                        fullWidth
                        margin="normal"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                        disabled={isLoading}
                        sx={{
                            '& .MuiOutlinedInput-root': {
                                '& fieldset': {
                                    borderColor: '#000000',
                                    transition: 'none',
                                },
                                '&:hover fieldset': {
                                    borderColor: '#000000',
                                    transition: 'none',
                                },
                                '&.Mui-focused fieldset': {
                                    borderColor: '#000000',
                                    transition: 'none',
                                },
                            },
                            '& .MuiInputLabel-root': {
                                color: '#000000',
                                transform: 'translate(14px, -6px) scale(0.75)',
                                backgroundColor: 'white',
                                padding: '0 4px',
                                transition: 'none',
                            },
                            '& .MuiInputLabel-root.Mui-focused': {
                                color: '#000000',
                                transform: 'translate(14px, -6px) scale(0.75)',
                                transition: 'none',
                            },
                            '& .MuiInputLabel-root.MuiFormLabel-filled': {
                                transform: 'translate(14px, -6px) scale(0.75)',
                                transition: 'none',
                            },
                        }}
                    />
                    <TextField
                        label="Senha"
                        type="password"
                        variant="outlined"
                        fullWidth
                        margin="normal"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        disabled={isLoading}
                        sx={{
                            '& .MuiOutlinedInput-root': {
                                '& fieldset': {
                                    borderColor: '#000000',
                                    transition: 'none',
                                },
                                '&:hover fieldset': {
                                    borderColor: '#000000',
                                    transition: 'none',
                                },
                                '&.Mui-focused fieldset': {
                                    borderColor: '#000000',
                                    transition: 'none',
                                },
                            },
                            '& .MuiInputLabel-root': {
                                color: '#000000',
                                transform: 'translate(14px, -6px) scale(0.75)',
                                backgroundColor: 'white',
                                padding: '0 4px',
                                transition: 'none',
                            },
                            '& .MuiInputLabel-root.Mui-focused': {
                                color: '#000000',
                                transform: 'translate(14px, -6px) scale(0.75)',
                                transition: 'none',
                            },
                            '& .MuiInputLabel-root.MuiFormLabel-filled': {
                                transform: 'translate(14px, -6px) scale(0.75)',
                                transition: 'none',
                            },
                        }}
                    />
                    {error && (
                        <Alert severity="error" sx={{ mt: 2 }}>
                            {error}
                        </Alert>
                    )}
                    <Button
                        type="submit"
                        variant="contained"
                        fullWidth
                        sx={{
                            mt: 2,
                            backgroundColor: '#000000',
                            color: '#ffffff',
                            '&:hover': {
                                backgroundColor: '#444444',
                            },
                        }}
                        disabled={isLoading}
                    >
                        {isLoading ? <CircularProgress size={24} /> : 'Entrar'}
                    </Button>
                </form>
            </Box>
        </Box>
    );
}

export default Login;