import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import debounce from 'lodash.debounce';
import {
    Box,
    Typography,
    TextField,
    Paper,
    Button,
} from '@mui/material';

function BuscarAluno({ apiUrl }) {
    const [searchQuery, setSearchQuery] = useState('');
    const [allStudents, setAllStudents] = useState([]); // Armazena todos os alunos
    const [filteredStudents, setFilteredStudents] = useState([]); // Alunos filtrados
    const [selectedStudent, setSelectedStudent] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    // Carregar todos os alunos ao montar o componente
    useEffect(() => {
        fetchAllStudents();
    }, [apiUrl]);

    const fetchAllStudents = async () => {
        setIsLoading(true);
        try {
            const response = await axios.get(`${apiUrl}/search-students`);
            // Deduplicar no frontend por segurança
            const uniqueStudents = Array.from(
                new Map(response.data.map(student => [student.registrationCode, student])).values()
            );
            setAllStudents(uniqueStudents);
        } catch (error) {
            console.error('Erro ao carregar alunos:', error);
        } finally {
            setIsLoading(false);
        }
    };

    // Função de filtragem com debounce
    const debouncedFilterStudents = useMemo(() => {
        return debounce((query) => {
            if (query.trim() === '') {
                setFilteredStudents([]);
            } else {
                const filtered = allStudents.filter(student =>
                    student.nomeCompleto.toLowerCase().includes(query.toLowerCase())
                );
                // Deduplicar os filtrados (caso haja algum problema nos dados)
                const uniqueFiltered = Array.from(
                    new Map(filtered.map(student => [student.registrationCode, student])).values()
                );
                setFilteredStudents(uniqueFiltered);
            }
        }, 300); // Atraso de 300ms
    }, [allStudents]);

    // Atualizar a busca quando o searchQuery mudar
    useEffect(() => {
        debouncedFilterStudents(searchQuery);
        return () => {
            debouncedFilterStudents.cancel(); // Cancelar debounce ao desmontar
        };
    }, [searchQuery, debouncedFilterStudents]);

    const handleStudentClick = (student) => {
        setSelectedStudent(student);
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'Data não disponível';
        const date = new Date(dateString);
        return date.toLocaleDateString('pt-BR');
    };

    // Limitar os resultados exibidos a 80 nomes
    const displayedStudents = filteredStudents.slice(0, 80);
    const hasMoreResults = filteredStudents.length > 80;

    return (
        <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="h6">
                    Buscar Aluno
                </Typography>
                <Button
                    variant="outlined"
                    onClick={fetchAllStudents}
                    disabled={isLoading}
                    sx={{ ml: 2 }}
                >
                    {isLoading ? 'Atualizando...' : 'Atualizar'}
                </Button>
            </Box>
            <TextField
                fullWidth
                variant="outlined"
                placeholder="Digite o nome do aluno"
                value={searchQuery}
                onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSelectedStudent(null); // Limpa o aluno selecionado ao alterar a busca
                }}
                disabled={isLoading}
                sx={{ mb: 2 }}
            />
            {isLoading && !searchQuery && <Typography variant="body2">Carregando alunos...</Typography>}

            {/* Lista de alunos */}
            {!selectedStudent && searchQuery && displayedStudents.length > 0 && (
                <Box sx={{ mb: 3 }}>
                    <Typography variant="h6" sx={{ mb: 1 }}>
                        Resultados da Busca
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                        {displayedStudents.map((student, index) => (
                            <Paper
                                key={student.registrationCode || `student-${index}`}
                                sx={{ p: 2, cursor: 'pointer', '&:hover': { backgroundColor: '#f5f5f5' } }}
                                onClick={() => handleStudentClick(student)}
                            >
                                <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
                                    {student.nomeCompleto}
                                </Typography>
                                <Typography variant="body2" color="textSecondary">
                                    {student.status}
                                </Typography>
                            </Paper>
                        ))}
                    </Box>
                    {hasMoreResults && (
                        <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
                            Mostrando os primeiros 80 resultados de {filteredStudents.length}. Refine sua busca para ver outros alunos.
                        </Typography>
                    )}
                </Box>
            )}

            {/* Mensagem quando não há resultados */}
            {!selectedStudent && searchQuery && displayedStudents.length === 0 && (
                <Typography variant="body1" sx={{ textAlign: 'center', mb: 3 }}>
                    Nenhum aluno encontrado com o nome "{searchQuery}".
                </Typography>
            )}

            {/* Detalhes do aluno selecionado */}
            {selectedStudent && (
                <Paper sx={{ p: 3, mb: 3 }}>
                    <Typography variant="h6" sx={{ mb: 2 }}>
                        Detalhes do Aluno
                    </Typography>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="body1">
                            <strong>Nome:</strong> {selectedStudent.nomeCompleto}
                        </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="body1">
                            <strong>Status:</strong> {selectedStudent.status}
                        </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="body1">
                            <strong>Telefone:</strong> {selectedStudent.cel || 'Não informado'}
                        </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="body1">
                            <strong>CPF:</strong> {selectedStudent.cpf || 'Não informado'}
                        </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="body1">
                            <strong>Email:</strong> {selectedStudent.emailPd || 'Não informado'}
                        </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="body1">
                            <strong>Psicólogo:</strong> {selectedStudent.psychologist || 'Não cadastrado'}
                        </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="body1">
                            <strong>Matrícula:</strong> {selectedStudent.registrationCode || 'Desconhecido'}
                        </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="body1">
                            <strong>Agente:</strong> {selectedStudent.agenteDoSucesso || 'Não informado'}
                        </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="body1">
                            <strong>Dia:</strong> {selectedStudent.monitoringDay || 'Não informado'}
                        </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="body1">
                            <strong>Entrada no curso:</strong> {formatDate(selectedStudent.createdAt)}
                        </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="body1">
                            <strong>Cidade:</strong>{" "}
                            {selectedStudent.cityId === "5b91aec2-e7ae-45e8-8146-bb7e5c40a8b6"
                                ? "Itabira"
                                : selectedStudent.cityId === "outra-cidade-id"
                                ? "Bom Despacho"
                                : "Desconhecida"}
                        </Typography>
                    </Box>
                    <Button
                        variant="contained"
                        color="secondary"
                        onClick={() => setSelectedStudent(null)}
                        sx={{ mt: 2 }}
                    >
                        Voltar
                    </Button>
                </Paper>
            )}
        </Box>
    );
}

export default BuscarAluno;