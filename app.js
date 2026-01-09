
// Logic for Ephemeral Chat

// TODO: Replace with actual keys after project creation
const SUPABASE_URL = 'https://fajtklsokzhqtkczhefj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhanRrbHNva3pocXRrY3poZWZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyMzgxMzQsImV4cCI6MjA4MjgxNDEzNH0.25ve97QSC3mqcnePAHkkph12_KxnLPg5v1t-GWok73Q';

let supabaseClient;

// State
let appState = {
    roomId: null,
    roomCode: null, // New State
    nickname: 'Guest',
    userId: null,
    isCreator: false
};

// DOM Elements
const views = {
    landing: document.getElementById('view-landing'),
    room: document.getElementById('room-view')
};

function init() {
    // Initialize Supabase if keys are present (Mock for now if not)
    if (SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    } else {
        console.warn('Supabase not initialized. Waiting for keys.');
    }

    setupEventListeners();
    checkUrlParams();
}

// --- Encryption Layout ---
class CryptoService {
    static async digestPassword(password) {
        const msgBuffer = new TextEncoder().encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    static async generateKey(password) {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            "raw",
            enc.encode(password),
            { name: "PBKDF2" },
            false,
            ["deriveKey"]
        );
        return crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: enc.encode("ephemeral-chat-salt"), // In prod, use random salt stored in room
                iterations: 100000,
                hash: "SHA-256"
            },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
    }

    static async encrypt(text, key) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(text);
        const ciphertext = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            key,
            encoded
        );

        // Return IV + Ciphertext as JSON string
        return JSON.stringify({
            iv: Array.from(iv),
            data: Array.from(new Uint8Array(ciphertext))
        });
    }

    static async decrypt(jsonStr, key) {
        try {
            const parsed = JSON.parse(jsonStr);
            const iv = new Uint8Array(parsed.iv);
            const data = new Uint8Array(parsed.data);

            const decrypted = await crypto.subtle.decrypt(
                { name: "AES-GCM", iv: iv },
                key,
                data
            );
            return new TextDecoder().decode(decrypted);
        } catch (e) {
            console.error("Decryption failed", e);
            return "🔒 Encrypted Message (Cannot Decrypt)";
        }
    }
}

function setupEventListeners() {
    // Tab Switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById(`${btn.dataset.tab}-form`).classList.add('active');
        });
    });

    // Legal Modal
    document.querySelectorAll('.policy-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('policy-modal').classList.remove('hidden');
        });
    });

    document.getElementById('btn-close-policy').addEventListener('click', () => {
        document.getElementById('policy-modal').classList.add('hidden');
    });

    // Create Room
    document.getElementById('btn-create').addEventListener('click', async () => {
        const nickname = document.getElementById('create-nickname').value.trim();
        const password = document.getElementById('create-password').value.trim();
        const duration = parseInt(document.getElementById('room-timer').value);
        const agreed = document.getElementById('create-agree').checked;

        if (!nickname) { alert("Nickname is required!"); return; }
        if (!password) { alert("Please set a password for encryption."); return; }
        if (!agreed) { alert("You must agree to the Terms & Privacy Policy."); return; }

        const button = document.getElementById('btn-create');
        button.disabled = true;
        button.textContent = "Creating...";

        try {
            await createRoom(nickname, password, duration);
        } catch (error) {
            alert(error.message);
            button.disabled = false;
            button.textContent = "Create Private Room";
        }
    });

    // Join Room
    document.getElementById('btn-join').addEventListener('click', async () => {
        const roomCode = document.getElementById('join-room-id').value.trim();
        const nickname = document.getElementById('join-nickname').value.trim();
        const password = document.getElementById('join-password').value.trim();
        const agreed = document.getElementById('join-agree').checked;

        if (!nickname) { alert("Nickname is required!"); return; }
        if (!agreed) { alert("You must agree to the Terms & Privacy Policy."); return; }

        if (roomCode) {
            const button = document.getElementById('btn-join');
            button.disabled = true;
            button.textContent = "Joining...";
            try {
                await joinRoom(roomCode, nickname, password);
            } catch (error) {
                // Duplicate Handling
                if (error.code === '23505') {
                    alert('This nickname is already taken in this room. Please choose another.');
                } else {
                    alert(error.message);
                }
                button.disabled = false;
                button.textContent = "Join Chat";
            }
        }
    });

    // Leave Room
    document.getElementById('btn-leave').addEventListener('click', () => leaveRoom(true));

    // Destroy Room
    document.getElementById('btn-self-destruct').addEventListener('click', async () => {
        if (confirm("💥 ARE YOU SURE? This will immediately delete the room and all messages for everyone.")) {
            await destroyRoom();
        }
    });

    // Send Message
    document.getElementById('btn-send').addEventListener('click', sendMessage);
    document.getElementById('message-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    // Participants Toggle
    document.getElementById('btn-participants').addEventListener('click', () => {
        const panel = document.getElementById('user-list-panel');
        panel.classList.toggle('hidden');
    });

    // Copy Link (Standard)
    document.getElementById('btn-copy-link').addEventListener('click', () => {
        const url = `${window.location.origin}${window.location.pathname}?room=${appState.roomCode}`;
        navigator.clipboard.writeText(url).then(() => alert(`Link copied! Code: ${appState.roomCode}`));
    });

    // Copy Link (With Password)
    document.getElementById('btn-copy-link-pass').addEventListener('click', () => {
        // We pass the raw password in the hash to keep it slightly out of server logs if they existed
        const url = `${window.location.origin}${window.location.pathname}?room=${appState.roomCode}&pass=${encodeURIComponent(appState.rawPassword)}`;
        navigator.clipboard.writeText(url).then(() => alert('Secret Link copied (Includes Password!)'));
    });

    // Dismiss Warning
    document.getElementById('btn-dismiss-warning').addEventListener('click', () => {
        document.getElementById('security-overlay').classList.add('hidden');
    });
}

function switchView(viewName) {
    Object.values(views).forEach(el => el.classList.add('hidden'));
    views[viewName].classList.remove('hidden');
    views[viewName].classList.add('active');
}

function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

async function createRoom(nickname, password, duration) {
    const expiresAt = new Date(Date.now() + duration * 60 * 1000).toISOString();
    const passwordHash = await CryptoService.digestPassword(password);
    const roomCode = generateRoomCode();

    // 1. Create Room
    const { data: roomData, error: roomError } = await supabaseClient
        .from('rooms')
        .insert([{
            expires_at: expiresAt,
            is_locked: false,
            password_hash: passwordHash,
            room_code: roomCode
        }])
        .select()
        .single();

    if (roomError) throw roomError;

    // 2. Add Creator as Participant (Admin)
    const { data: partData, error: partError } = await supabaseClient
        .from('room_participants')
        .insert([{
            room_id: roomData.id,
            nickname: nickname,
            is_admin: true,
            status: 'active'
        }])
        .select()
        .single();

    if (partError) throw partError;

    appState.nickname = nickname;
    appState.isCreator = true;
    appState.participantId = partData.id;
    appState.roomId = roomData.id;
    appState.roomCode = roomCode;
    appState.expiresAt = new Date(roomData.expires_at);
    appState.rawPassword = password;
    appState.cryptoKey = await CryptoService.generateKey(password);

    enterRoomUI(roomData.id);
}

async function joinRoom(roomCodeInput, nickname, password) {
    // 0. Resolve Code to UUID
    // 1. Check if room exists and get hash
    const { data: roomData, error: roomError } = await supabaseClient
        .from('rooms')
        .select('*')
        .eq('room_code', roomCodeInput)
        .single();

    if (roomError || !roomData) throw new Error("Room Code not found.");

    const roomId = roomData.id; // Get the UUID

    // 0. Check Ban Status
    if (localStorage.getItem(`banned:${roomId}`)) {
        throw new Error("You have been kicked/banned from this room.");
    }

    // 2. Validate Password
    let passwordToUse = password;
    if (!passwordToUse) {
        // If not provided in input, maybe we can prompt?
        // For now, assume it must be provided or was in URL
        passwordToUse = prompt("Enter Room Password:");
    }

    if (!passwordToUse) throw new Error("Password required");

    const inputHash = await CryptoService.digestPassword(passwordToUse);
    if (inputHash !== roomData.password_hash) {
        throw new Error("Invalid Password");
    }

    // 3. Add as Participant
    const { data: partData, error: partError } = await supabaseClient
        .from('room_participants')
        .insert([{
            room_id: roomId,
            nickname: nickname,
            is_admin: false,
            status: 'active'
        }])
        .select()
        .single();

    if (partError) throw partError;

    appState.nickname = nickname;
    appState.isCreator = false; // Until we check participant table logic strictly, assume false for joiners
    appState.participantId = partData.id;
    appState.roomId = roomId;
    appState.roomCode = roomData.room_code;
    appState.expiresAt = new Date(roomData.expires_at);
    appState.rawPassword = passwordToUse;
    appState.cryptoKey = await CryptoService.generateKey(passwordToUse);

    enterRoomUI(roomId);
}

let roomSubscription;
let timerInterval;

function enterRoomUI(roomId) {
    switchView('room');
    addSystemMessage(`Joined room: ${roomId}`);
    document.getElementById('room-status').textContent = "● Live & Encrypted";

    // Display Code
    if (appState.roomCode) {
        const displayEl = document.getElementById('room-code-display');
        if (displayEl) displayEl.textContent = `#${appState.roomCode}`;
    }

    // Toggle Admin Buttons
    if (appState.isCreator) {
        document.getElementById('btn-self-destruct').classList.remove('hidden');
    } else {
        document.getElementById('btn-self-destruct').classList.add('hidden');
    }

    fetchMessages(roomId);
    fetchParticipants(roomId);

    // Filter for THIS room specifically to avoid mixups
    const channel = supabaseClient.channel(`room:${roomId}`);

    // ROOM self-destruct listener (Listen to public schema table rooms)
    channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, () => {
        alert("💥 ROOM DESTROYED BY HOST");
        leaveRoom(false);
    });

    // Messages
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, async payload => {
        if (payload.new.sender_nickname !== appState.nickname) {
            const decryptedText = await CryptoService.decrypt(payload.new.content, appState.cryptoKey);
            addMessage(decryptedText, payload.new.sender_nickname, false);
        }
    });

    // Participants
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'room_participants', filter: `room_id=eq.${roomId}` }, payload => {
        // Handle Kick
        if (payload.eventType === 'UPDATE' && payload.new.id === appState.participantId && payload.new.status === 'kicked') {
            // Store Ban Locally
            localStorage.setItem(`banned:${roomId}`, 'true');

            alert('You have been kicked and banned from this room.');
            leaveRoom(false); // False = don't update DB status, just exit locally
            return;
        }

        // Refresh list on any change
        fetchParticipants(roomId);
    });

    roomSubscription = channel.subscribe();

    // Start Timer
    startTimer();
}

async function destroyRoom() {
    // Use RPC to securely delete (checks password hash server-side)
    const { error } = await supabaseClient.rpc('delete_room_securely', {
        room_id_input: appState.roomId,
        password_attempt: appState.rawPassword
    });

    if (error) {
        alert("Failed to destroy room: " + error.message);
    }
}

async function fetchParticipants(roomId) {
    const { data, error } = await supabaseClient
        .from('room_participants')
        .select('*')
        .eq('room_id', roomId)
        .eq('status', 'active'); // Only show active users

    if (data) {
        renderUserList(data);
    }
}

function renderUserList(users) {
    const list = document.getElementById('user-list');
    list.innerHTML = '';

    document.getElementById('user-count').textContent = users.length;

    users.forEach(user => {
        const li = document.createElement('li');
        li.className = 'user-item';

        // 1. User Info Container
        const infoDiv = document.createElement('div');
        infoDiv.className = 'user-info';

        // Nickname (Safe Text)
        const nameSpan = document.createElement('span');
        nameSpan.textContent = user.nickname;
        infoDiv.appendChild(nameSpan);

        // Badges
        if (user.is_admin) {
            const badge = document.createElement('span');
            badge.className = 'user-badge admin';
            badge.textContent = 'Host';
            infoDiv.appendChild(badge);
        }
        if (user.nickname === appState.nickname) {
            const badge = document.createElement('span');
            badge.className = 'user-badge';
            badge.textContent = 'You';
            // Add a slight margin or gap via CSS, or relies on flex gap involved in .user-info?
            // Existing CSS .user-info { display: flex; align-items: center; gap: 8px; } handles it.
            infoDiv.appendChild(badge);
        }

        li.appendChild(infoDiv);

        // 2. Action Button (Kick)
        if (appState.isCreator && user.nickname !== appState.nickname) {
            const btn = document.createElement('button');
            btn.className = 'btn-kick';
            btn.textContent = 'Kick';
            btn.onclick = () => kickUser(user.id);
            li.appendChild(btn);
        }

        list.appendChild(li);
    });
}

// Make kick function globally available for onclick
window.kickUser = async function (userInfoId) {
    if (!confirm("Are you sure you want to kick this user?")) return;

    const { error } = await supabaseClient
        .from('room_participants')
        .update({ status: 'kicked' })
        .eq('id', userInfoId);

    if (error) {
        console.error("Kick failed", error);
        alert("Failed to kick user.");
    }
};

function startTimer() {
    updateTimerDisplay();
    timerInterval = setInterval(updateTimerDisplay, 1000);
}

function updateTimerDisplay() {
    const now = new Date();
    const diff = appState.expiresAt - now;

    if (diff <= 0) {
        clearInterval(timerInterval);
        document.getElementById('room-timer-display').textContent = "EXPIRED";
        alert("This room has expired.");
        leaveRoom(true);
        return;
    }

    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    document.getElementById('room-timer-display').textContent =
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

async function fetchMessages(roomId) {
    const { data, error } = await supabaseClient
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true });

    if (error) console.error(error);
    if (data) {
        document.getElementById('chat-container').innerHTML = '';
        addSystemMessage(`🔒 This chat is E2E encrypted using your password.`);

        for (const msg of data) {
            const isMe = msg.sender_nickname === appState.nickname;
            const text = await CryptoService.decrypt(msg.content, appState.cryptoKey);
            addMessage(text, msg.sender_nickname, isMe);
        }
    }
}

async function leaveRoom(shouldUpdateStatus = true) {
    if (roomSubscription) supabaseClient.removeChannel(roomSubscription);
    if (timerInterval) clearInterval(timerInterval);

    // Update Status to Ended/Left
    if (shouldUpdateStatus && appState.participantId) {
        await supabaseClient
            .from('room_participants')
            .update({ status: 'left' })
            .eq('id', appState.participantId);
    }

    appState.roomId = null;
    appState.roomCode = null;
    appState.expiresAt = null;
    appState.cryptoKey = null;
    appState.rawPassword = null;
    appState.participantId = null;

    switchView('landing');
    document.getElementById('chat-container').innerHTML = '';

    // Reset buttons
    document.getElementById('btn-join').disabled = false;
    document.getElementById('btn-create').disabled = false;
    document.getElementById('btn-create').textContent = "Create Private Room";
    document.getElementById('btn-join').textContent = "Join Chat";
}

async function sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    if (!content) return;

    // Optimistic Update
    addMessage(content, appState.nickname, true);
    input.value = '';

    // Encrypt
    const encryptedContent = await CryptoService.encrypt(content, appState.cryptoKey);

    const { error } = await supabaseClient
        .from('messages')
        .insert([{
            room_id: appState.roomId,
            content: encryptedContent,
            sender_nickname: appState.nickname,
            type: 'text'
        }]);

    if (error) {
        console.error('Send failed', error);
        addSystemMessage('Failed to send message.');
    }
}

function addMessage(text, sender, isSent) {
    const container = document.getElementById('chat-container');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${isSent ? 'sent' : 'received'}`;

    const senderSpan = document.createElement('span');
    senderSpan.className = 'sender-name';
    senderSpan.textContent = sender;

    const contentP = document.createElement('p');
    contentP.textContent = text;

    if (!isSent) msgDiv.appendChild(senderSpan);
    msgDiv.appendChild(contentP);

    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

function addSystemMessage(text) {
    const container = document.getElementById('chat-container');
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message system';
    msgDiv.innerHTML = `<p>${text}</p>`;
    container.appendChild(msgDiv);
}

function checkUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const room = urlParams.get('room');
    const pass = urlParams.get('pass');

    if (room) {
        document.getElementById('join-room-id').value = room;
        if (pass) {
            // Auto-fill and optional auto-join could go here
            document.getElementById('join-password').value = pass;
        }
    }
}

// Start
init();
