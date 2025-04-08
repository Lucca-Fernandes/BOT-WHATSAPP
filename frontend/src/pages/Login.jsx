import React, { useState } from 'react';
import { TextField, Button, Box, Alert, CircularProgress } from '@mui/material';

import logo from '../assets/logo-horizontal-texto-preto.png'; 

function Login() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        setTimeout(() => {
            const validUsername = 'admin';
            const validPassword = '123456';

            if (username === validUsername && password === validPassword) {
                localStorage.setItem('isAuthenticated', 'true');
                window.location.href = '/bot';
            } else {
                setError('Usuário ou senha incorretos');
            }
            setIsLoading(false);
        }, 1000);
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
                        maxWidth: '220px', 
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
                                    borderColor: '#000000', // Borda preta
                                    transition: 'none', // Remove transições
                                },
                                '&:hover fieldset': {
                                    borderColor: '#000000', // Borda preta no hover
                                    transition: 'none', // Remove transições
                                },
                                '&.Mui-focused fieldset': {
                                    borderColor: '#000000', // Borda preta no foco
                                    transition: 'none', // Remove transições
                                },
                            },
                            '& .MuiInputLabel-root': {
                                color: '#000000', // Cor do label preta
                                transform: 'translate(14px, -6px) scale(0.75)', // Fixa o label na posição "flutuante"
                                backgroundColor: 'white', // Fundo branco para cobrir a borda
                                padding: '0 4px', // Espaçamento para o fundo
                                transition: 'none', // Remove transições
                            },
                            '& .MuiInputLabel-root.Mui-focused': {
                                color: '#000000', // Cor do label preta no foco
                                transform: 'translate(14px, -6px) scale(0.75)', // Mantém o label fixo
                                transition: 'none', // Remove transições
                            },
                            '& .MuiInputLabel-root.MuiFormLabel-filled': {
                                transform: 'translate(14px, -6px) scale(0.75)', // Mantém o label fixo quando preenchido
                                transition: 'none', // Remove transições
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
                                    borderColor: '#000000', // Borda preta
                                    transition: 'none', // Remove transições
                                },
                                '&:hover fieldset': {
                                    borderColor: '#000000', // Borda preta no hover
                                    transition: 'none', // Remove transições
                                },
                                '&.Mui-focused fieldset': {
                                    borderColor: '#000000', // Borda preta no foco
                                    transition: 'none', // Remove transições
                                },
                            },
                            '& .MuiInputLabel-root': {
                                color: '#000000', // Cor do label preta
                                transform: 'translate(14px, -6px) scale(0.75)', // Fixa o label na posição "flutuante"
                                backgroundColor: 'white', // Fundo branco para cobrir a borda
                                padding: '0 4px', // Espaçamento para o fundo
                                transition: 'none', // Remove transições
                            },
                            '& .MuiInputLabel-root.Mui-focused': {
                                color: '#000000', // Cor do label preta no foco
                                transform: 'translate(14px, -6px) scale(0.75)', // Mantém o label fixo
                                transition: 'none', // Remove transições
                            },
                            '& .MuiInputLabel-root.MuiFormLabel-filled': {
                                transform: 'translate(14px, -6px) scale(0.75)', // Mantém o label fixo quando preenchido
                                transition: 'none', // Remove transições
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
                            backgroundColor: '#000000', // Cor de fundo preta
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