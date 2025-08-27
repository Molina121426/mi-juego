let gameState = {
    secretCode: [],
    clues: [],
    attemptsLeft: 4,
    difficulty: 'easy',
    lastUpdate: null,
    codeLength: 3,
    maxAttempts: 4,
    clueCount: 6,
    gameMode: 'classic',
    timeLeft: 60,
    timerInterval: null,
    startTime: null,
    currentPlayer: 1,
    player1Score: 0,
    player2Score: 0,
    totalWins: 0,
    winStreak: 0,
    fastestTime: null,
    gamesPlayed: 0,
    // Variables multijugador local
    isCodeInputPhase: false,
    playerCreatedCode: [],
    // Variables multijugador online
    isOnline: false,
    playerId: null,
    roomCode: null,
    playerName: '',
    opponentName: '',
    onlinePlayer1Score: 0,
    onlinePlayer2Score: 0,
    isMyTurnToCreate: false,
    gameSocket: null,
    chatMessages: [],
    onlineGameStarted: false,
    selectedOnlineDifficulty: 'easy',
    discardedDigits: new Set()
};

const difficultySettings = {
    easy: { codeLength: 3, maxAttempts: 4, clueCount: 6 },
    medium: { codeLength: 4, maxAttempts: 3, clueCount: 6 },
    hard: { codeLength: 5, maxAttempts: 2, clueCount: 6 }
};

function getTimerForDifficulty(difficulty) {
    switch (difficulty) {
        case 'easy': return 180;
        case 'medium': return 120;
        case 'hard': return 60;
        default: return 60;
    }
}

// Simulación de WebSocket para multijugador online
class GameSocket {
    constructor() {
        this.isConnected = false;
        this.rooms = new Map();
        this.players = new Map();
        this.messageHandlers = new Map();
        this.usedRoomCodes = new Set();
    }

    connect(playerName) {
        return new Promise((resolve) => {
            setTimeout(() => {
                this.isConnected = true;
                const playerId = 'player_' + Math.random().toString(36).substr(2, 9);
                this.players.set(playerId, { name: playerName, room: null });
                resolve(playerId);
            }, 1000);
        });
    }

    createRoom(playerId) {
        return new Promise((resolve) => {
            setTimeout(() => {
                let roomCode;
                do {
                    roomCode = Math.random().toString(36).substr(2, 6).toUpperCase();
                } while (this.usedRoomCodes.has(roomCode) || (this.invalidatedCodes && this.invalidatedCodes.has(roomCode)));

                this.usedRoomCodes.add(roomCode);

                const room = {
                    code: roomCode,
                    players: [playerId],
                    gameState: {
                        currentCreator: playerId,
                        scores: { [playerId]: 0 },
                        secretCode: null,
                        gameActive: false,
                        gameStarted: false,
                        difficulty: 'easy'
                    },
                    messages: []
                };
                this.rooms.set(roomCode, room);
                this.players.get(playerId).room = roomCode;
                resolve(roomCode);
            }, 500);
        });
    }

    joinRoom(playerId, roomCode) {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                if (!this.usedRoomCodes.has(roomCode) || (this.invalidatedCodes && this.invalidatedCodes.has(roomCode))) {
                    reject('Código de sala inválido, expirado o cerrado permanentemente');
                    return;
                }

                const room = this.rooms.get(roomCode);
                if (!room) {
                    reject('Sala no encontrada o cerrada');
                    return;
                }
                if (room.players.length >= 2) {
                    reject('Sala llena');
                    return;
                }

                room.players.push(playerId);
                room.gameState.scores[playerId] = 0;
                this.players.get(playerId).room = roomCode;

                this.broadcastToRoom(roomCode, 'playerJoined', {
                    playerId,
                    playerName: this.players.get(playerId).name,
                    players: room.players.map(id => ({
                        id,
                        name: this.players.get(id).name
                    }))
                });

                resolve(room);
            }, 500);
        });
    }

    leaveRoom(playerId) {
        const player = this.players.get(playerId);
        if (!player || !player.room) return;

        const roomCode = player.room;
        const room = this.rooms.get(roomCode);
        if (room) {
            room.players = room.players.filter(id => id !== playerId);
            if (room.players.length === 0) {
                this.rooms.delete(roomCode);
            } else {
                this.broadcastToRoom(roomCode, 'playerLeft', {
                    playerId,
                    playerName: player.name
                });
            }
        }
        player.room = null;
    }

    sendMessage(playerId, type, data) {
        const player = this.players.get(playerId);
        if (!player || !player.room) return;

        this.broadcastToRoom(player.room, type, {
            ...data,
            senderId: playerId,
            senderName: player.name
        });
    }

    broadcastToRoom(roomCode, type, data) {
        const room = this.rooms.get(roomCode);
        if (!room) return;

        room.players.forEach(playerId => {
            if (this.messageHandlers.has(playerId)) {
                setTimeout(() => {
                    this.messageHandlers.get(playerId)(type, data);
                }, 100);
            }
        });
    }

    onMessage(playerId, handler) {
        this.messageHandlers.set(playerId, handler);
    }

    disconnect(playerId) {
        this.leaveRoom(playerId);
        this.players.delete(playerId);
        this.messageHandlers.delete(playerId);
    }
}

const gameSocket = new GameSocket();

// Funciones de selección en pantalla de inicio
function selectGameMode(mode) {
    gameState.gameMode = mode;
    document.querySelectorAll('#gameModeOptions .option-card').forEach(card => {
        card.classList.remove('selected');
    });
    document.querySelector(`#gameModeOptions [data-mode="${mode}"]`).classList.add('selected');
}

function selectDifficulty(difficulty) {
    gameState.difficulty = difficulty;
    const settings = difficultySettings[difficulty];
    gameState.codeLength = settings.codeLength;
    gameState.maxAttempts = settings.maxAttempts;
    gameState.clueCount = settings.clueCount;
    gameState.attemptsLeft = settings.maxAttempts;

    document.querySelectorAll('#difficultyOptions .option-card').forEach(card => {
        card.classList.remove('selected');
    });
    document.querySelector(`#difficultyOptions [data-difficulty="${difficulty}"]`).classList.add('selected');
}

function startGameFromMenu() {
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.add('active');

    // Mostrar botón de menú fijo
    document.getElementById('fixedMenuButton').classList.add('show');

    // Configurar el juego según el modo seleccionado
    setupGameMode();
}

function returnToMenu() {
    // Limpiar estado del juego
    stopTimer();

    if (gameState.isOnline && gameState.roomCode) {
        // Cerrar sala online y eliminar código permanentemente
        closeOnlineRoom();
    }

    // Resetear estado del juego completamente
    resetGameState();

    // Resetear configuraciones a valores por defecto
    resetToDefaultSettings();

    // Ocultar pantalla de juego y mostrar menú
    document.getElementById('gameScreen').classList.remove('active');
    document.getElementById('startScreen').classList.remove('hidden');

    // Ocultar botón de menú fijo
    document.getElementById('fixedMenuButton').classList.remove('show');

    // Ocultar contador de intentos
    document.getElementById('attemptsCounter').classList.remove('show');

    // Mostrar secciones de juego que podrían estar ocultas
    const cluesSection = document.getElementById('cluesSection');
    const answerSection = document.querySelector('.answer-section');
    cluesSection.style.display = 'block';
    answerSection.style.display = 'block';

    // Cerrar cualquier modal abierto
    closeModal();

    showNotification('¡Regresaste al menú principal!', 'success');
}

function closeOnlineRoom() {
    if (gameState.playerId && gameState.roomCode) {
        // Notificar al oponente que la sala se cerrará
        gameSocket.sendMessage(gameState.playerId, 'roomClosed', {
            message: `${gameState.playerName} cerró la sala`
        });

        // Eliminar la sala del servidor y marcar el código como inválido permanentemente
        gameSocket.rooms.delete(gameState.roomCode);
        gameSocket.usedRoomCodes.delete(gameState.roomCode);

        // Agregar el código a una lista de códigos invalidados para evitar reutilización
        if (!gameSocket.invalidatedCodes) {
            gameSocket.invalidatedCodes = new Set();
        }
        gameSocket.invalidatedCodes.add(gameState.roomCode);

        // Desconectar al jugador
        gameSocket.disconnect(gameState.playerId);

        addSystemMessage('Sala cerrada permanentemente. El código ya no se puede usar.');
    }
}

function resetGameState() {
    // Resetear variables de juego
    gameState.secretCode = [];
    gameState.clues = [];
    gameState.attemptsLeft = gameState.maxAttempts;
    gameState.isCodeInputPhase = false;
    gameState.playerCreatedCode = [];

    // Resetear variables online
    gameState.isOnline = false;
    gameState.playerId = null;
    gameState.roomCode = null;
    gameState.playerName = '';
    gameState.opponentName = '';
    gameState.onlineGameStarted = false;
    gameState.isMyTurnToCreate = false;
    gameState.gameSocket = null;
    gameState.chatMessages = [];

    // Limpiar inputs
    const answerInputs = document.querySelectorAll('.answer-digit');
    answerInputs.forEach(input => input.value = '');

    const codeInputs = document.querySelectorAll('.code-digit');
    codeInputs.forEach(input => input.value = '');

    // Limpiar campos de entrada online
    document.getElementById('playerName').value = '';
    document.getElementById('roomCode').value = '';

    // Resetear displays
    hideCodeInputSection();
    hideOnlineCodeInputSection();
    clearChat();
    
    // Asegurarse de que las secciones de pistas y respuestas sean visibles
    document.getElementById('cluesSection').style.display = 'block';
    document.querySelector('.answer-section').style.display = 'block';
}

function resetToDefaultSettings() {
    // Resetear selecciones a valores por defecto
    gameState.gameMode = 'classic';
    gameState.difficulty = 'easy';
    gameState.currentPlayer = 1;

    // Resetear configuraciones de dificultad
    const settings = difficultySettings['easy'];
    gameState.codeLength = settings.codeLength;
    gameState.maxAttempts = settings.maxAttempts;
    gameState.clueCount = settings.clueCount;
    gameState.attemptsLeft = settings.maxAttempts;

    // Resetear tiempo según dificultad
    gameState.timeLeft = getTimerForDifficulty('easy');

    // Resetear selecciones visuales en el menú
    document.querySelectorAll('#gameModeOptions .option-card').forEach(card => {
        card.classList.remove('selected');
    });
    document.querySelector('#gameModeOptions [data-mode="classic"]').classList.add('selected');

    document.querySelectorAll('#difficultyOptions .option-card').forEach(card => {
        card.classList.remove('selected');
    });
    document.querySelector('#difficultyOptions [data-difficulty="easy"]').classList.add('selected');
}

function playAgain() {
    closeModal();

    // Resetear los números descartados
    gameState.discardedDigits = new Set();

    if (gameState.gameMode === 'multiplayer') {
        // Intercambiar roles automáticamente en multijugador local
        gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
        gameState.isCodeInputPhase = true;
        gameState.attemptsLeft = gameState.maxAttempts;
        gameState.playerCreatedCode = [];

        // Ocultar secciones de juego
        const cluesSection = document.getElementById('cluesSection');
        const answerSection = document.querySelector('.answer-section');
        const attemptsCounter = document.getElementById('attemptsCounter');

        cluesSection.style.display = 'none';
        answerSection.style.display = 'none';
        attemptsCounter.classList.remove('show');

        // Limpiar inputs
        const answerInputs = document.querySelectorAll('.answer-digit');
        answerInputs.forEach(input => input.value = '');

        // Mostrar sección de creación de código
        updateMultiplayerLocalDisplay();
        showCodeInputSection();

        document.getElementById('attemptsLeft').textContent = gameState.attemptsLeft;

        showNotification(`¡Nueva ronda! Jugador ${gameState.currentPlayer}, crea tu código secreto`, 'success');
    } else if (gameState.gameMode === 'online') {
        // Intercambiar roles automáticamente en multijugador online
        gameState.isMyTurnToCreate = !gameState.isMyTurnToCreate;
        gameState.attemptsLeft = gameState.maxAttempts;
        document.getElementById('attemptsLeft').textContent = gameState.attemptsLeft;

        // Limpiar inputs
        const answerInputs = document.querySelectorAll('.answer-digit');
        answerInputs.forEach(input => input.value = '');

        // Ocultar secciones de juego temporalmente
        const cluesSection = document.getElementById('cluesSection');
        const answerSection = document.querySelector('.answer-section');
        const attemptsCounter = document.getElementById('attemptsCounter');

        cluesSection.style.display = 'none';
        answerSection.style.display = 'none';
        attemptsCounter.classList.remove('show');

        if (gameState.isMyTurnToCreate) {
            showOnlineCodeInputSection();
            addSystemMessage('Nueva ronda: tu turno de crear el código');
            showNotification('Tu turno: crea el código secreto', 'success');
        } else {
            hideOnlineCodeInputSection();
            addSystemMessage('Nueva ronda: esperando el código del oponente...');
            showNotification('Esperando el código del oponente...', 'success');
        }

        // Notificar al oponente sobre el cambio de roles
        gameSocket.sendMessage(gameState.playerId, 'roleSwitch', {
            newCreator: gameState.isMyTurnToCreate ? gameState.playerId : 'opponent'
        });
    } else {
        // Modos clásico y contrarreloj - generar nuevo juego
        generateNewGame();
        showNotification('¡Nueva partida iniciada!', 'success');
    }
}

function setupGameMode() {
    const timerDisplay = document.getElementById('timerDisplay');
    const multiplayerSection = document.getElementById('multiplayerSection');
    const onlineSection = document.getElementById('onlineSection');
    const cluesSection = document.getElementById('cluesSection');
    const answerSection = document.querySelector('.answer-section');
    const attemptsCounter = document.getElementById('attemptsCounter');

    // Ocultar todas las secciones específicas
    timerDisplay.classList.remove('active');
    multiplayerSection.classList.remove('active');
    onlineSection.classList.remove('active');
    attemptsCounter.classList.remove('show');

    if (gameState.gameMode === 'timed') {
        timerDisplay.classList.add('active');
        gameState.timeLeft = getTimerForDifficulty(gameState.difficulty);
        document.getElementById('timeLeft').textContent = gameState.timeLeft;
        generateNewGame();
        attemptsCounter.classList.add('show');
        startTimer();
    } else if (gameState.gameMode === 'multiplayer') {
        multiplayerSection.classList.add('active');
        setupMultiplayerLocal();
        cluesSection.style.display = 'none';
        answerSection.style.display = 'none';
    } else if (gameState.gameMode === 'online') {
        onlineSection.classList.add('active');
        setupMultiplayerOnline();
        cluesSection.style.display = 'none';
        answerSection.style.display = 'none';
    } else if (gameState.gameMode === 'classic') {
        generateNewGame();
        attemptsCounter.classList.add('show');
    }
}

function generateRandomCode(length = gameState.codeLength) {
    const code = [];
    for (let i = 0; i < length; i++) {
        code.push(Math.floor(Math.random() * 10));
    }
    return code;
}

function generateUniqueNumberFactory(existingNumbers) {
    return () => {
        let num;
        do {
            num = Math.floor(Math.random() * 10);
        } while (existingNumbers.has(num));
        existingNumbers.add(num);
        return num;
    };
}

function generateClues(secretCode) {
    const clues = [];
    const codeLength = secretCode.length;
    const uniqueDigits = [...new Set(secretCode)];
    const digitPositions = {};

    // Mapear posiciones de cada dígito
    secretCode.forEach((digit, index) => {
        if (!digitPositions[digit]) digitPositions[digit] = [];
        digitPositions[digit].push(index);
    });

    // Mezclar array (Fisher-Yates)
    const shuffleArray = (arr) => {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    };

    // Conjunto para almacenar números descartados de otras pistas
    const discardedNumbers = new Set();

    // Función mejorada para generar números no secretos
    function generateNonSecretNumbers(count, mustIncludeDiscarded = false) {
        const available = Array.from({ length: 10 }, (_, i) => i)
            .filter(n => !gameState.secretCode.includes(n));

        if (available.length === 0) return Array(count).fill(0); // Fallback

        // Pista "🔴 Ningún número es correcto" (mustIncludeDiscarded = true)
        if (mustIncludeDiscarded) {
            // --- Dificultad MEDIUM (1-1-1-1 siempre) ---
            if (gameState.difficulty === 'medium') {
                const discarded = [];
                gameState.clues.forEach(clue => {
                    if (clue.type !== "all_wrong") {
                        clue.code.forEach(num => {
                            if (!gameState.secretCode.includes(num) && !discarded.includes(num)) {
                                discarded.push(num);
                            }
                        });
                    }
                });

                const selected = discarded.length >= 4 ?
                    discarded.slice(0, 4) :
                    [
                        ...discarded,
                        ...shuffleArray(available.filter(n => !discarded.includes(n)))
                            .slice(0, 4 - discarded.length)
                    ];
                return shuffleArray(selected).slice(0, count);
            }
            // --- Dificultad HARD (dejarla EXACTAMENTE como estaba) ---
            else if (gameState.difficulty === 'hard') {
                const counts = countRepeats(gameState.secretCode);
                const hasRepeatedNumbers = Object.values(counts).some(c => c > 1);

                if (hasRepeatedNumbers) {
                    // Proporción 2-1-1-1 (original)
                    const discarded = [];
                    gameState.clues.forEach(clue => {
                        if (clue.type !== "all_wrong") {
                            clue.code.forEach(num => {
                                if (!gameState.secretCode.includes(num) && !discarded.includes(num)) {
                                    discarded.push(num);
                                }
                            });
                        }
                    });

                    const [num1, num2, num3, num4] = discarded.length >= 4 ?
                        discarded.slice(0, 4) :
                        [
                            ...discarded,
                            ...shuffleArray(available.filter(n => !discarded.includes(n)))
                                .slice(0, 4 - discarded.length)
                        ];
                    return shuffleArray([num1, num1, num2, num3, num4]).slice(0, count);
                } else {
                    // Proporción 2-2-1 (original - cuando no hay repeticiones)
                    const discarded = [];
                    gameState.clues.forEach(clue => {
                        if (clue.type !== "all_wrong") {
                            clue.code.forEach(num => {
                                if (!gameState.secretCode.includes(num) && !discarded.includes(num)) {
                                    discarded.push(num);
                                }
                            });
                        }
                    });

                    const [num1, num2, num3] = discarded.length >= 3 ?
                        discarded.slice(0, 3) :
                        [
                            ...discarded,
                            ...shuffleArray(available.filter(n => !discarded.includes(n)))
                                .slice(0, 3 - discarded.length)
                        ];
                    return shuffleArray([num1, num1, num2, num2, num3]).slice(0, count);
                }
            }
        }

        // Para otras pistas (no "🔴..."), mantener lógica original
        return shuffleArray(available).slice(0, count);
    }

    // Función auxiliar: elige un dígito de los que faltan o uno aleatorio del código
    const getNextDigit = () => {
        return uniqueDigits[Math.floor(Math.random() * uniqueDigits.length)];
    };

    // Función que devuelve una posición válida para colocar un dígito en "correcta posición"
    const getRandomCorrectPosition = (digit) => {
        const positions = digitPositions[digit];
        return positions[Math.floor(Math.random() * positions.length)];
    };

    // Función que devuelve una posición válida para colocar un dígito en "posición incorrecta"
    const getRandomWrongPosition = (digit, excludePositions = []) => {
        const invalidPositions = digitPositions[digit].concat(excludePositions);
        const validPositions = [];
        for (let i = 0; i < codeLength; i++) {
            if (!invalidPositions.includes(i)) validPositions.push(i);
        }
        return validPositions[Math.floor(Math.random() * validPositions.length)];
    };

    // Lista de dígitos que deben aparecer en las pistas
    let digitsToShow = [...uniqueDigits];

    // Generar todas las pistas fijas primero
    const fixedClues = [];

    // 1️⃣ Un número correcto y en la posición correcta
    {
        const clue = Array(codeLength).fill(null);
        const digit = digitsToShow.length > 0 ? digitsToShow.shift() : getNextDigit();
        const pos = getRandomCorrectPosition(digit);
        clue[pos] = digit;

        const wrongNums = generateNonSecretNumbers(codeLength - 1);
        // Añadir números incorrectos a los descartados
        wrongNums.forEach(num => discardedNumbers.add(num));

        let idx = 0;
        for (let i = 0; i < codeLength; i++) {
            if (i !== pos) clue[i] = wrongNums[idx++];
        }

        fixedClues.push({
            code: clue,
            hint: "🟢 Un número está correcto y en la posición correcta",
            type: "correct_position"
        });
    }

    // 2️⃣ Un número correcto en posición incorrecta
    {
        const clue = Array(codeLength).fill(null);
        const digit = digitsToShow.length > 0 ? digitsToShow.shift() : getNextDigit();
        const pos = getRandomWrongPosition(digit);
        clue[pos] = digit;

        const wrongNums = generateNonSecretNumbers(codeLength - 1);
        // Añadir números incorrectos a los descartados
        wrongNums.forEach(num => discardedNumbers.add(num));

        let idx = 0;
        for (let i = 0; i < codeLength; i++) {
            if (i !== pos) clue[i] = wrongNums[idx++];
        }

        fixedClues.push({
            code: clue,
            hint: "🟡 Un número está correcto pero en la posición incorrecta",
            type: "wrong_position"
        });
    }

    // 3️⃣ Ningún número es correcto (incluyendo números descartados)
    {
        const clue = generateNonSecretNumbers(codeLength, true);
        fixedClues.push({
            code: clue,
            hint: "🔴 Ningún número es correcto",
            type: "all_wrong"
        });
    }

    // 5️⃣ Dos números correctos en posiciones incorrectas (si aplica)
    if (codeLength >= 3) {
        const clue = Array(codeLength).fill(null);

        const digitsForClue = [];
        while (digitsForClue.length < 2 && digitsToShow.length > 0) {
            const next = digitsToShow.shift();
            if (!digitsForClue.includes(next)) digitsForClue.push(next);
        }
        while (digitsForClue.length < 2) {
            const next = getNextDigit();
            if (!digitsForClue.includes(next)) digitsForClue.push(next);
        }

        digitsForClue.forEach(digit => {
            const pos = getRandomWrongPosition(digit, Object.values(clue).map((v, i) => v !== null ? i : -1).filter(i => i !== -1));
            clue[pos] = digit;
        });

        const wrongNums = generateNonSecretNumbers(codeLength - 2);
        // Añadir números incorrectos a los descartados
        wrongNums.forEach(num => discardedNumbers.add(num));

        let idx = 0;
        for (let i = 0; i < codeLength; i++) {
            if (clue[i] === null) clue[i] = wrongNums[idx++];
        }

        fixedClues.push({
            code: clue,
            hint: "🟡 Dos números están correctos pero en posiciones incorrectas",
            type: "two_wrong_position"
        });
    }

    // 6️⃣ Varios números correctos en posición correcta
    {
        const correctCount = Math.min(2, codeLength);
        const clue = Array(codeLength).fill(null);

        const positionsToShow = [];
        while (positionsToShow.length < correctCount && digitsToShow.length > 0) {
            const digit = digitsToShow.shift();
            const pos = getRandomCorrectPosition(digit);
            if (!positionsToShow.includes(pos)) positionsToShow.push(pos);
        }
        while (positionsToShow.length < correctCount) {
            const digit = getNextDigit();
            const pos = getRandomCorrectPosition(digit);
            if (!positionsToShow.includes(pos)) positionsToShow.push(pos);
        }

        positionsToShow.forEach(pos => {
            clue[pos] = secretCode[pos];
        });

        const wrongNums = generateNonSecretNumbers(codeLength - correctCount);
        // Añadir números incorrectos a los descartados
        wrongNums.forEach(num => discardedNumbers.add(num));

        let idx = 0;
        for (let i = 0; i < codeLength; i++) {
            if (clue[i] === null) clue[i] = wrongNums[idx++];
        }

        fixedClues.push({
            code: clue,
            hint: `🟢 ${correctCount} números están correctos y en las posiciones correctas`,
            type: "multiple_correct"
        });
    }

    // 4️⃣ Pistas lógicas
    const logicalClues = generateLogicalClues(secretCode);
    if (logicalClues.length > 0) {
        fixedClues.push(logicalClues[0]);
    }

    // Mezclar el orden de las pistas fijas (excepto la lógica)
    const shuffledClues = shuffleArray(fixedClues.filter(c => c.type !== "repeated_number" && c.type !== "logical_even_odd" && c.type !== "logical_sum"));

    // Asegurar que la pista lógica esté al final
    const logicalClue = fixedClues.find(c => c.type === "repeated_number" || c.type === "logical_even_odd" || c.type === "logical_sum");
    if (logicalClue) {
        shuffledClues.push(logicalClue);
    }

    return shuffledClues.slice(0, gameState.clueCount);
}



function countRepeats(code) {
    const counts = {};
    code.forEach(num => {
        counts[num] = (counts[num] || 0) + 1;
    });
    return counts;
}

function generateLogicalClues(secretCode) {
    const clues = [];
    const codeLength = secretCode.length;
    const counts = countRepeats(secretCode);
    const repeatedNumbers = Object.entries(counts).filter(([num, count]) => count > 1);

    // Pista: Números repetidos (nueva pista)
    if (repeatedNumbers.length === 2) {  // Solo si hay exactamente 2 números repetidos
        clues.push({
            code: [],
            hint: "🔢 Hay dos números que se repiten",
            type: "two_repeated_numbers"
        });
    }
    // Pista original: Número que se repite (si hay alguno)
    else if (repeatedNumbers.length > 0) {
        const times = repeatedNumbers[0][1];
        clues.push({
            code: [],
            hint: `🔢 Hay un número que se repite ${times} veces`,
            type: "repeated_number"
        });
    }

    // Pista: Números pares/impares en posiciones específicas
    const evenNumbers = secretCode.filter(n => n % 2 === 0);
    const oddNumbers = secretCode.filter(n => n % 2 === 1);

    if (evenNumbers.length > 0 && oddNumbers.length > 0) {
        const evenPositions = [];
        const oddPositions = [];

        secretCode.forEach((num, index) => {
            if (num % 2 === 0) evenPositions.push(index + 1);
            else oddPositions.push(index + 1);
        });

        if (evenPositions.length === 1) {
            clues.push({
                code: [],
                hint: `🔢 Solo hay un número par y está en la posición ${evenPositions[0]}`,
                type: "logical_even_odd"
            });
        } else if (oddPositions.length === 1) {
            clues.push({
                code: [],
                hint: `🔢 Solo hay un número impar y está en la posición ${oddPositions[0]}`,
                type: "logical_even_odd"
            });
        }
    }

    // Pista: Suma de dígitos
    const sum = secretCode.reduce((a, b) => a + b, 0);
    if (sum % 2 === 0) {
        clues.push({
            code: [],
            hint: `➕ La suma de todos los dígitos es un número par`,
            type: "logical_sum"
        });
    } else {
        clues.push({
            code: [],
            hint: `➕ La suma de todos los dígitos es un número impar`,
            type: "logical_sum"
        });
    }

    return clues;
}


function renderClues() {
    const container = document.getElementById('cluesContainer');
    container.innerHTML = '';

    gameState.clues.forEach((clue, index) => {
        const clueCard = document.createElement('div');
        clueCard.className = 'clue-card';

        let codeDigits = '';
        if (clue.code.length > 0) {
            codeDigits = clue.code.map((digit, i) => {
                const isDiscarded = gameState.discardedDigits.has(digit);
                return `<div class="digit ${isDiscarded ? 'discarded' : ''}" 
                         data-digit="${digit}" 
                         data-clue-index="${index}" 
                         data-digit-index="${i}">${digit}</div>`;
            }).join('');
        } else {
            codeDigits = '<div class="digit" style="background: linear-gradient(135deg, #74b9ff, #0984e3); width: auto; padding: 0 20px;">💡</div>';
        }

        clueCard.innerHTML = `
            <div class="clue-code">
                ${codeDigits}
            </div>
            <div class="clue-hint">
                ${clue.hint}
            </div>
        `;

        container.appendChild(clueCard);
    });

    // Añadir event listeners a los dígitos
    document.querySelectorAll('.digit').forEach(digit => {
        digit.addEventListener('click', function () {
            const digitValue = this.getAttribute('data-digit');
            if (this.classList.contains('discarded')) {
                this.classList.remove('discarded');
                gameState.discardedDigits.delete(parseInt(digitValue));
            } else {
                this.classList.add('discarded');
                gameState.discardedDigits.add(parseInt(digitValue));
            }
        });
    });
}

function setupMultiplayerLocal() {
    gameState.isCodeInputPhase = true;
    gameState.currentPlayer = 1;
    updateMultiplayerLocalDisplay();
    showCodeInputSection();
}

function setupMultiplayerOnline() {
    gameState.isOnline = false;
    gameState.playerId = null;
    gameState.roomCode = null;
    gameState.onlineGameStarted = false;
    updateOnlineDisplay();
}

function updateMultiplayerLocalDisplay() {
    const player1Card = document.getElementById('player1Card');
    const player2Card = document.getElementById('player2Card');

    player1Card.classList.remove('active');
    player2Card.classList.remove('active');

    if (gameState.currentPlayer === 1) {
        player1Card.classList.add('active');
        document.getElementById('player1Role').textContent = gameState.isCodeInputPhase ? 'Creando código...' : 'Esperando...';
        document.getElementById('player2Role').textContent = gameState.isCodeInputPhase ? 'Esperando...' : 'Descifrando...';
    } else {
        player2Card.classList.add('active');
        document.getElementById('player1Role').textContent = gameState.isCodeInputPhase ? 'Esperando...' : 'Descifrando...';
        document.getElementById('player2Role').textContent = gameState.isCodeInputPhase ? 'Creando código...' : 'Esperando...';
    }

    document.getElementById('player1Score').textContent = gameState.player1Score;
    document.getElementById('player2Score').textContent = gameState.player2Score;
}

function showCodeInputSection() {
    const section = document.getElementById('codeInputSection');
    section.classList.add('active');
    createCodeInputs();
}

function hideCodeInputSection() {
    const section = document.getElementById('codeInputSection');
    section.classList.remove('active');
}

function createCodeInputs() {
    const container = document.getElementById('codeInput');
    container.innerHTML = '';

    for (let i = 0; i < gameState.codeLength; i++) {
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'code-digit';
        input.id = `codeDigit${i + 1}`;
        input.min = '0';
        input.max = '9';
        input.maxLength = '1';
        container.appendChild(input);
    }

    setupCodeInputHandlers();
}

function setupCodeInputHandlers() {
    const inputs = document.querySelectorAll('.code-digit');
    inputs.forEach((input, index) => {
        input.addEventListener('input', function () {
            if (this.value.length > 1) {
                this.value = this.value.slice(0, 1);
            }
            if (this.value && index < inputs.length - 1) {
                inputs[index + 1].focus();
            }
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Backspace' && !this.value && index > 0) {
                inputs[index - 1].focus();
            }
        });
    });
}

function submitSecretCode() {
    const inputs = document.querySelectorAll('.code-digit');
    const code = [];

    for (let i = 0; i < inputs.length; i++) {
        if (!inputs[i].value) {
            showNotification('Por favor, completa todos los dígitos del código', 'error');
            return;
        }
        code.push(parseInt(inputs[i].value));
    }

    if (code.every(digit => digit === code[0])) {
        showNotification('No puedes usar todos los números iguales. Intenta con un código más variado.', 'error');
        return;
    }

    gameState.playerCreatedCode = code;
    gameState.secretCode = code;
    gameState.clues = generateClues(code);
    gameState.isCodeInputPhase = false;

    hideCodeInputSection();
    updateMultiplayerLocalDisplay();

    const cluesSection = document.getElementById('cluesSection');
    const answerSection = document.querySelector('.answer-section');
    const attemptsCounter = document.getElementById('attemptsCounter');

    cluesSection.style.display = 'block';
    answerSection.style.display = 'block';
    attemptsCounter.classList.add('show');

    renderClues();
    createAnswerInputs();

    showNotification(`¡Código creado! Ahora el Jugador ${gameState.currentPlayer === 1 ? '2' : '1'} debe descifrarlo`, 'success');
}

function switchRoles() {
    if (gameState.gameMode !== 'multiplayer') return;

    gameState.discardedDigits = new Set();

    gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
    gameState.isCodeInputPhase = true;
    gameState.attemptsLeft = gameState.maxAttempts;

    document.getElementById('attemptsLeft').textContent = gameState.attemptsLeft;

    const cluesSection = document.getElementById('cluesSection');
    const answerSection = document.querySelector('.answer-section');
    const attemptsCounter = document.getElementById('attemptsCounter');

    cluesSection.style.display = 'none';
    answerSection.style.display = 'none';
    attemptsCounter.classList.remove('show');

    updateMultiplayerLocalDisplay();
    showCodeInputSection();

    const answerInputs = document.querySelectorAll('.answer-digit');
    answerInputs.forEach(input => input.value = '');
}

function resetMultiplayerScores() {
    gameState.player1Score = 0;
    gameState.player2Score = 0;
    updateMultiplayerLocalDisplay();
    showNotification('Puntuaciones reiniciadas', 'success');
}

// Funciones de multijugador online
async function createRoom() {
    const playerName = document.getElementById('playerName').value.trim();
    if (!playerName) {
        showNotification('Por favor, ingresa tu nombre', 'error');
        return;
    }

    try {
        updateConnectionStatus('Creando sala...', 'waiting');

        gameState.playerId = await gameSocket.connect(playerName);
        gameState.roomCode = await gameSocket.createRoom(gameState.playerId);
        gameState.playerName = playerName;
        gameState.isOnline = true;

        setupOnlineMessageHandler();
        updateConnectionStatus(`Sala creada: ${gameState.roomCode} - Esperando jugador...`, 'waiting');
        updateOnlineDisplay();

        showNotification(`Sala creada: ${gameState.roomCode}`, 'success');
    } catch (error) {
        showNotification('Error al crear la sala', 'error');
        updateConnectionStatus('Error al crear la sala', 'disconnected');
    }
}

async function joinRoom() {
    const playerName = document.getElementById('playerName').value.trim();
    const roomCode = document.getElementById('roomCode').value.trim().toUpperCase();

    if (!playerName) {
        showNotification('Por favor, ingresa tu nombre', 'error');
        return;
    }

    if (!roomCode) {
        showNotification('Por favor, ingresa el código de la sala', 'error');
        return;
    }

    try {
        updateConnectionStatus('Conectando...', 'waiting');

        gameState.playerId = await gameSocket.connect(playerName);
        const room = await gameSocket.joinRoom(gameState.playerId, roomCode);

        gameState.roomCode = roomCode;
        gameState.playerName = playerName;
        gameState.isOnline = true;

        setupOnlineMessageHandler();
        updateConnectionStatus(`Conectado a sala: ${roomCode}`, 'connected');
        updateOnlineDisplay();

        showNotification(`Te uniste a la sala: ${roomCode}`, 'success');
    } catch (error) {
        showNotification(error, 'error');
        updateConnectionStatus(error, 'disconnected');
    }
}

function leaveRoom() {
    if (gameState.playerId) {
        gameSocket.disconnect(gameState.playerId);
    }

    gameState.isOnline = false;
    gameState.playerId = null;
    gameState.roomCode = null;
    gameState.playerName = '';
    gameState.opponentName = '';
    gameState.onlineGameStarted = false;
    gameState.isMyTurnToCreate = false;

    hideOnlineCodeInputSection();

    updateConnectionStatus('Desconectado', 'disconnected');
    updateOnlineDisplay();
    clearChat();

    showNotification('Has salido de la sala', 'warning');
}

function setupOnlineMessageHandler() {
    gameSocket.onMessage(gameState.playerId, (type, data) => {
        switch (type) {
            case 'playerJoined':
                handlePlayerJoined(data);
                break;
            case 'playerLeft':
                handlePlayerLeft(data);
                break;
            case 'chatMessage':
                handleChatMessage(data);
                break;
            case 'gameStarted':
                handleOnlineGameStarted(data);
                break;
            case 'codeSubmitted':
                handleOnlineCodeSubmitted(data);
                break;
            case 'answerSubmitted':
                handleOnlineAnswerSubmitted(data);
                break;
            case 'gameEnd':
                handleOnlineGameEnd(data);
                break;
            case 'roomClosed':
                handleRoomClosed(data);
                break;
            case 'roleSwitch':
                handleRoleSwitch(data);
                break;
        }
    });
}

function handlePlayerJoined(data) {
    if (data.players.length === 2) {
        const opponent = data.players.find(p => p.id !== gameState.playerId);
        gameState.opponentName = opponent.name;
        updateConnectionStatus(`Conectado - Listo para jugar con ${opponent.name}`, 'connected');
        updateOnlineDisplay();

        addSystemMessage(`${opponent.name} se unió. ¡Presiona "Comenzar Juego Online" para iniciar!`);
    } else {
        addSystemMessage(`${data.playerName} se unió a la sala`);
    }
}

function handlePlayerLeft(data) {
    addSystemMessage(`${data.playerName} salió de la sala`);
    updateConnectionStatus(`Esperando jugador... Sala: ${gameState.roomCode}`, 'waiting');
    gameState.opponentName = '';
    updateOnlineDisplay();
}

function handleChatMessage(data) {
    if (data.senderId !== gameState.playerId) {
        addChatMessage(data.senderName, data.message, false);
    }
}

function handleOnlineGameStarted(data) {
    if (data.senderId !== gameState.playerId) {
        const settings = data.settings;
        gameState.codeLength = settings.codeLength;
        gameState.maxAttempts = settings.maxAttempts;
        gameState.clueCount = settings.clueCount;
        gameState.attemptsLeft = settings.maxAttempts;
        gameState.onlineGameStarted = true;

        // El que recibe el mensaje de inicio será el segundo en crear
        gameState.isMyTurnToCreate = false;

        updateOnlineDisplay();
        createAnswerInputs();

        addSystemMessage(`${data.senderName} inició el juego en dificultad ${data.difficulty}. Esperando su código...`);
        showNotification(`Juego iniciado por ${data.senderName}`, 'success');
    }
}

function handleOnlineCodeSubmitted(data) {
    gameState.discardedDigits = new Set();

    gameState.secretCode = data.secretCode;
    gameState.clues = data.clues;
    gameState.attemptsLeft = gameState.maxAttempts;

    const cluesSection = document.getElementById('cluesSection');
    const answerSection = document.querySelector('.answer-section');
    const attemptsCounter = document.getElementById('attemptsCounter');

    cluesSection.style.display = 'block';
    answerSection.style.display = 'block';
    attemptsCounter.classList.add('show');

    renderClues();
    document.getElementById('attemptsLeft').textContent = gameState.attemptsLeft;

    addSystemMessage('¡Tu oponente creó el código! Tu turno de adivinar.');
}

function handleOnlineAnswerSubmitted(data) {
    if (data.correct) {
        if (data.playerId !== gameState.playerId) {
            gameState.onlinePlayer2Score = data.scores[data.playerId] || 0;
            gameState.onlinePlayer1Score = data.scores[gameState.playerId] || 0;
        }
        updateOnlineScores();
        addSystemMessage(`${data.playerName} adivinó el código correctamente!`);
    } else {
        addSystemMessage(`${data.playerName} falló. Intentos restantes: ${data.attemptsLeft}`);
    }
}

function handleOnlineGameEnd(data) {
    updateOnlineScores();

    gameState.isMyTurnToCreate = !gameState.isMyTurnToCreate;

    const cluesSection = document.getElementById('cluesSection');
    const answerSection = document.querySelector('.answer-section');
    cluesSection.style.display = 'none';
    answerSection.style.display = 'none';

    if (gameState.isMyTurnToCreate) {
        showOnlineCodeInputSection();
        addSystemMessage('Nueva ronda: tu turno de crear el código');
    } else {
        addSystemMessage('Nueva ronda: esperando el código del oponente...');
    }
}

function handleRoomClosed(data) {
    addSystemMessage(data.message);
    showNotification('La sala ha sido cerrada por el otro jugador', 'warning');

    // Resetear estado online
    gameState.isOnline = false;
    gameState.playerId = null;
    gameState.roomCode = null;
    gameState.playerName = '';
    gameState.opponentName = '';
    gameState.onlineGameStarted = false;
    gameState.isMyTurnToCreate = false;

    // Actualizar display
    updateConnectionStatus('Sala cerrada - Desconectado', 'disconnected');
    updateOnlineDisplay();

    // Ocultar secciones de juego
    const cluesSection = document.getElementById('cluesSection');
    const answerSection = document.querySelector('.answer-section');
    cluesSection.style.display = 'none';
    answerSection.style.display = 'none';

    hideOnlineCodeInputSection();

    setTimeout(() => {
        returnToMenu();
    }, 2000);
}

function handleRoleSwitch(data) {
    // El oponente cambió los roles, actualizar mi estado
    gameState.isMyTurnToCreate = data.newCreator !== gameState.playerId;
    gameState.attemptsLeft = gameState.maxAttempts;
    document.getElementById('attemptsLeft').textContent = gameState.attemptsLeft;

    // Limpiar inputs
    const answerInputs = document.querySelectorAll('.answer-digit');
    answerInputs.forEach(input => input.value = '');

    // Ocultar secciones de juego temporalmente
    const cluesSection = document.getElementById('cluesSection');
    const answerSection = document.querySelector('.answer-section');
    const attemptsCounter = document.getElementById('attemptsCounter');

    cluesSection.style.display = 'none';
    answerSection.style.display = 'none';
    attemptsCounter.classList.remove('show');

    if (gameState.isMyTurnToCreate) {
        showOnlineCodeInputSection();
        addSystemMessage('Nueva ronda: tu turno de crear el código');
    } else {
        hideOnlineCodeInputSection();
        addSystemMessage('Nueva ronda: esperando el código del oponente...');
    }
}

function startOnlineGame() {
    if (!gameState.isOnline || !gameState.opponentName) {
        showNotification('Necesitas estar conectado con otro jugador', 'error');
        return;
    }

    const settings = difficultySettings[gameState.difficulty];
    gameState.codeLength = settings.codeLength;
    gameState.maxAttempts = settings.maxAttempts;
    gameState.clueCount = settings.clueCount;
    gameState.attemptsLeft = settings.maxAttempts;
    gameState.onlineGameStarted = true;

    gameSocket.sendMessage(gameState.playerId, 'gameStarted', {
        difficulty: gameState.difficulty,
        settings: settings
    });

    // El primer jugador que inicia siempre comienza creando
    gameState.isMyTurnToCreate = true;

    updateOnlineDisplay();
    createAnswerInputs();

    showOnlineCodeInputSection();
    addSystemMessage('¡Juego iniciado! Tu turno: crea el código secreto');

    showNotification(`Juego iniciado en dificultad ${gameState.difficulty}`, 'success');
}

function updateOnlineDisplay() {
    const playerInfo = document.getElementById('onlinePlayerInfo');
    const leaveBtn = document.getElementById('leaveRoomBtn');
    const chatSection = document.getElementById('chatSection');
    const startGameSection = document.getElementById('onlineStartGameSection');

    if (gameState.isOnline && gameState.opponentName) {
        playerInfo.style.display = 'flex';
        leaveBtn.style.display = 'inline-block';
        chatSection.classList.add('active');

        if (!gameState.onlineGameStarted) {
            startGameSection.style.display = 'block';
        } else {
            startGameSection.style.display = 'none';
        }

        document.getElementById('onlinePlayer1Name').textContent = gameState.playerName;
        document.getElementById('onlinePlayer2Name').textContent = gameState.opponentName;

        updateOnlineScores();
    } else if (gameState.isOnline) {
        playerInfo.style.display = 'none';
        leaveBtn.style.display = 'inline-block';
        chatSection.classList.add('active');
        startGameSection.style.display = 'none';
    } else {
        playerInfo.style.display = 'none';
        leaveBtn.style.display = 'none';
        chatSection.classList.remove('active');
        startGameSection.style.display = 'none';
    }
}

function updateOnlineScores() {
    document.getElementById('onlinePlayer1Score').textContent = gameState.onlinePlayer1Score;
    document.getElementById('onlinePlayer2Score').textContent = gameState.onlinePlayer2Score;
}

function showOnlineCodeInputSection() {
    const section = document.getElementById('onlineCodeInputSection');
    section.classList.add('active');
    createOnlineCodeInputs();
}

function hideOnlineCodeInputSection() {
    const section = document.getElementById('onlineCodeInputSection');
    section.classList.remove('active');
}

function createOnlineCodeInputs() {
    const container = document.getElementById('onlineCodeInput');
    container.innerHTML = '';

    for (let i = 0; i < gameState.codeLength; i++) {
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'code-digit';
        input.id = `onlineCodeDigit${i + 1}`;
        input.min = '0';
        input.max = '9';
        input.maxLength = '1';
        container.appendChild(input);
    }

    setupOnlineCodeInputHandlers();
}

function setupOnlineCodeInputHandlers() {
    const inputs = document.querySelectorAll('#onlineCodeInput .code-digit');
    inputs.forEach((input, index) => {
        input.addEventListener('input', function () {
            if (this.value.length > 1) {
                this.value = this.value.slice(0, 1);
            }
            if (this.value && index < inputs.length - 1) {
                inputs[index + 1].focus();
            }
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Backspace' && !this.value && index > 0) {
                inputs[index - 1].focus();
            }
        });
    });
}

function submitOnlineSecretCode() {
    const inputs = document.querySelectorAll('#onlineCodeInput .code-digit');
    const code = [];

    for (let i = 0; i < inputs.length; i++) {
        if (!inputs[i].value) {
            showNotification('Por favor, completa todos los dígitos del código', 'error');
            return;
        }
        code.push(parseInt(inputs[i].value));
    }

    if (code.every(digit => digit === code[0])) {
        showNotification('No puedes usar todos los números iguales. Intenta con un código más variado.', 'error');
        return;
    }

    const clues = generateClues(code);

    gameSocket.sendMessage(gameState.playerId, 'codeSubmitted', {
        secretCode: code,
        clues: clues
    });

    hideOnlineCodeInputSection();
    addSystemMessage('Código enviado. Esperando a que tu oponente adivine...');
}

function updateConnectionStatus(message, status) {
    const statusEl = document.getElementById('connectionStatus');
    statusEl.textContent = message;
    statusEl.className = `connection-status ${status}`;
}

// Funciones de chat
function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();

    if (!message || !gameState.isOnline) return;

    gameSocket.sendMessage(gameState.playerId, 'chatMessage', { message });
    addChatMessage(gameState.playerName, message, true);
    input.value = '';
}

function addChatMessage(playerName, message, isOwn) {
    const messagesContainer = document.getElementById('chatMessages');
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${isOwn ? 'own' : ''}`;
    messageEl.innerHTML = `<strong>${playerName}:</strong> ${message}`;

    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addSystemMessage(message) {
    const messagesContainer = document.getElementById('chatMessages');
    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message system';
    messageEl.textContent = message;

    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function clearChat() {
    document.getElementById('chatMessages').innerHTML = '';
}

function startTimer() {
    if (gameState.gameMode !== 'timed') return;

    // Detener cualquier temporizador existente
    stopTimer();

    // Configurar el tiempo inicial
    gameState.startTime = Date.now();
    gameState.lastUpdate = Date.now();

    gameState.timerInterval = setInterval(() => {
        const now = Date.now();
        const elapsedSeconds = Math.floor((now - gameState.startTime) / 1000);
        const remainingTime = getTimerForDifficulty(gameState.difficulty) - elapsedSeconds;

        // Solo actualizar si el tiempo ha cambiado
        if (remainingTime !== gameState.timeLeft) {
            gameState.timeLeft = remainingTime;
            document.getElementById('timeLeft').textContent = gameState.timeLeft;

            const timerDisplay = document.getElementById('timerDisplay');
            if (gameState.timeLeft <= 10) {
                timerDisplay.classList.add('warning');
            } else {
                timerDisplay.classList.remove('warning');
            }

            if (gameState.timeLeft <= 0) {
                stopTimer();
                const secretCodeStr = gameState.secretCode.join('');

                // Mostrar notificación primero
                showNotification('¡Tiempo agotado! Has perdido.', 'error');

                // Pequeño retraso antes de mostrar el modal
                setTimeout(() => {
                    showResult(false, `¡Se acabó el tiempo! El código secreto era ${secretCodeStr}`);
                }, 500);
            }
        }
    }, 100);
}

function stopTimer() {
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
        gameState.timerInterval = null;
    }
}

function updateStats() {
    document.getElementById('totalWins').textContent = gameState.totalWins;
    document.getElementById('winStreak').textContent = gameState.winStreak;
    document.getElementById('fastestTime').textContent = gameState.fastestTime ? gameState.fastestTime + 's' : '--';
}

function openHelpModal() {
    document.getElementById('overlay').style.display = 'block';
    document.getElementById('helpModal').style.display = 'block';
}

function closeHelpModal() {
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('helpModal').style.display = 'none';
}

function createAnswerInputs() {
    const container = document.getElementById('answerInput');
    container.innerHTML = '';

    for (let i = 0; i < gameState.codeLength; i++) {
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'answer-digit';
        input.id = `digit${i + 1}`;
        input.min = '0';
        input.max = '9';
        input.maxLength = '1';
        container.appendChild(input);
    }

    setupInputHandlers();
}

function setupInputHandlers() {
    const inputs = document.querySelectorAll('.answer-digit');
    inputs.forEach((input, index) => {
        input.addEventListener('input', function () {
            if (this.value.length > 1) {
                this.value = this.value.slice(0, 1);
            }
            if (this.value && index < inputs.length - 1) {
                inputs[index + 1].focus();
            }
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Backspace' && !this.value && index > 0) {
                inputs[index - 1].focus();
            }
        });
    });
}

function checkAnswer() {
    const inputs = document.querySelectorAll('.answer-digit');
    const userCode = [];

    for (let i = 0; i < inputs.length; i++) {
        if (!inputs[i].value) {
            showNotification('Por favor, completa todos los dígitos del código', 'error');
            return;
        }
        userCode.push(parseInt(inputs[i].value));
    }

    const isCorrect = userCode.every((digit, index) => digit === gameState.secretCode[index]);

    if (isCorrect) {
        stopTimer();

        let timeElapsed = null;
        if (gameState.gameMode === 'timed' && gameState.startTime) {
            timeElapsed = Math.floor((Date.now() - gameState.startTime) / 1000);
            if (!gameState.fastestTime || timeElapsed < gameState.fastestTime) {
                gameState.fastestTime = timeElapsed;
            }
        }

        gameState.totalWins++;
        gameState.winStreak++;
        gameState.gamesPlayed++;

        let message = `¡Excelente! El código secreto era ${gameState.secretCode.join('')}`;
        if (timeElapsed) {
            message += `\n⏱️ Tiempo: ${timeElapsed} segundos`;
        }

        if (gameState.gameMode === 'multiplayer') {
            if (gameState.currentPlayer === 1) {
                gameState.player1Score++;
                message = `🎉 ¡Jugador 1 ganó!\nEl código secreto era ${gameState.secretCode.join('')}`;
            } else {
                gameState.player2Score++;
                message = `🎉 ¡Jugador 2 ganó!\nEl código secreto era ${gameState.secretCode.join('')}`;
            }
            updateMultiplayerLocalDisplay();
        } else if (gameState.gameMode === 'online' && gameState.isOnline) {
            gameSocket.sendMessage(gameState.playerId, 'answerSubmitted', {
                correct: true,
                answer: userCode
            });
            if (gameState.isMyTurnToCreate) {
                gameState.onlinePlayer1Score++;
            } else {
                gameState.onlinePlayer2Score++;
            }
            updateOnlineScores();
            message = `🎉 ¡Ganaste!\nEl código secreto era ${gameState.secretCode.join('')}`;
        }

        saveStats();
        updateStats();
        showResult(true, message);
    } else {
        gameState.attemptsLeft--;
        document.getElementById('attemptsLeft').textContent = gameState.attemptsLeft;

        if (gameState.gameMode === 'online' && gameState.isOnline) {
            gameSocket.sendMessage(gameState.playerId, 'answerSubmitted', {
                correct: false,
                answer: userCode,
                attemptsLeft: gameState.attemptsLeft
            });
        }

        if (gameState.attemptsLeft === 0) {
            stopTimer();
            gameState.winStreak = 0;
            gameState.gamesPlayed++;

            saveStats();
            updateStats();

            let failureMessage = `¡Se acabaron los intentos! El código secreto era ${gameState.secretCode.join('')}`;

            if (gameState.gameMode === 'multiplayer') {
                const winnerPlayer = gameState.currentPlayer === 1 ? 2 : 1;
                failureMessage = `😔 ¡Jugador ${gameState.currentPlayer} perdió!\n¡Jugador ${winnerPlayer} ganó por defecto!\nEl código secreto era ${gameState.secretCode.join('')}`;
            } else if (gameState.gameMode === 'online' && gameState.isOnline) {
                failureMessage = `😔 ¡Perdiste!\nEl código secreto era ${gameState.secretCode.join('')}`;
            }

            showResult(false, failureMessage);
        } else {
            showNotification(`Código incorrecto. Te quedan ${gameState.attemptsLeft} intentos.`, 'warning');
        }
    }
}

function saveStats() {
    localStorage.setItem('gameStats', JSON.stringify({
        totalWins: gameState.totalWins,
        winStreak: gameState.winStreak,
        fastestTime: gameState.fastestTime,
        gamesPlayed: gameState.gamesPlayed,
        player1Score: gameState.player1Score,
        player2Score: gameState.player2Score
    }));
}

function loadStats() {
    const saved = localStorage.getItem('gameStats');
    if (saved) {
        const stats = JSON.parse(saved);
        gameState.totalWins = stats.totalWins || 0;
        gameState.winStreak = stats.winStreak || 0;
        gameState.fastestTime = stats.fastestTime || null;
        gameState.gamesPlayed = stats.gamesPlayed || 0;
        gameState.player1Score = stats.player1Score || 0;
        gameState.player2Score = stats.player2Score || 0;
    }
}

function showResult(success, message) {
    const modal = document.getElementById('resultModal');
    const title = document.getElementById('resultTitle');
    const messageEl = document.getElementById('resultMessage');

    if (success) {
        modal.className = 'result-modal success';
        title.textContent = '🎉 ¡Felicitaciones!';
    } else {
        modal.className = 'result-modal failure';
        title.textContent = '😔 ¡Mejor suerte la próxima vez!';
    }

    messageEl.textContent = message;
    document.getElementById('overlay').style.display = 'block';
    modal.style.display = 'block';
}

function closeModal() {
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('resultModal').style.display = 'none';
    document.getElementById('helpModal').style.display = 'none';
}

function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('show');
    }, 100);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
}

function generateNewGame() {
    stopTimer();

    if (gameState.gameMode === 'multiplayer' && gameState.isCodeInputPhase) {
        return;
    }

    if (gameState.gameMode === 'online') {
        return;
    }

    // Resetear los números descartados
    gameState.discardedDigits = new Set();

    gameState.secretCode = generateRandomCode();
    gameState.clues = generateClues(gameState.secretCode);
    gameState.attemptsLeft = gameState.maxAttempts;
    gameState.timeLeft = getTimerForDifficulty(gameState.difficulty);

    document.getElementById('attemptsLeft').textContent = gameState.attemptsLeft;
    document.getElementById('timeLeft').textContent = gameState.timeLeft;

    const timerDisplay = document.getElementById('timerDisplay');
    const attemptsCounter = document.getElementById('attemptsCounter');

    timerDisplay.classList.remove('warning');
    attemptsCounter.classList.add('show');

    createAnswerInputs();
    renderClues();
    closeModal();

    if (gameState.gameMode === 'timed') {
        startTimer();
    }
}

// Event listener para enviar mensaje con Enter
document.addEventListener('DOMContentLoaded', function () {
    loadStats();
    updateStats();
    checkDarkModePreference(); // Añade esta línea
    
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
        chatInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    }
});

function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDarkMode = document.body.classList.contains('dark-mode');
    localStorage.setItem('darkMode', isDarkMode ? 'true' : 'false');
    
    // Cambiar el ícono y texto del botón
    const darkModeToggle = document.getElementById('darkModeToggle');
    if (isDarkMode) {
        darkModeToggle.innerHTML = 'Modo: <span>☀️</span>';
    } else {
        darkModeToggle.innerHTML = 'Modo: <span>🌙</span>';
    }
}

function checkDarkModePreference() {
    const darkModeToggle = document.getElementById('darkModeToggle');
    const isDarkMode = localStorage.getItem('darkMode') === 'true';
    
    if (isDarkMode) {
        document.body.classList.add('dark-mode');
        darkModeToggle.innerHTML = 'Modo: <span>☀️</span>';
    } else {
        document.body.classList.remove('dark-mode');
        darkModeToggle.innerHTML = 'Modo: <span>🌙</span>';
    }
}