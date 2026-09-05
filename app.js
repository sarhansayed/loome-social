document.addEventListener('DOMContentLoaded', () => {
    let currentUser = null;
    let selectedMessageId = null;
    let currentReplyId = null;
    let currentRoomId = null;
    let jitsiApi = null;
    let mediaRecorder = null;
    let audioChunks = [];

    // --- Authentication ---
    const authForm = document.getElementById('auth-form');
    const btnAnon = document.getElementById('btn-anon');
    const btnLogout = document.getElementById('btn-logout');

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        let { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            const signup = await supabase.auth.signUp({ email, password });
            if (signup.error) return alert("خطأ في تسجيل الدخول: " + signup.error.message);
            data = signup.data;
        }
        currentUser = data.user;
        initApp();
    });

    btnAnon.addEventListener('click', () => {
        const anonId = Math.floor(Math.random() * 10000);
        currentUser = { id: 'anon_' + anonId, email: `visitor_${anonId}@loome.local` };
        initApp();
    });

    btnLogout.addEventListener('click', () => {
        location.reload();
    });

    function initApp() {
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('main-content').style.display = 'flex';
        loadGlobalMessages();
        subscribeRealtime();
        loadRooms();
    }

    // --- Context Menu & Reactions ---
    window.openContextMenu = function(msgId, isOwner = false) {
        selectedMessageId = msgId;
        const menu = document.getElementById('context-menu');
        menu.style.display = 'flex';
        document.getElementById('ctx-delete').style.display = isOwner ? 'block' : 'none';
    };

    document.getElementById('ctx-cancel').addEventListener('click', () => {
        document.getElementById('context-menu').style.display = 'none';
    });

    document.getElementById('ctx-reply').addEventListener('click', () => {
        currentReplyId = selectedMessageId;
        document.getElementById('reply-preview-text').innerText = `الرد على رسالة...`;
        document.getElementById('reply-preview').style.display = 'flex';
        document.getElementById('context-menu').style.display = 'none';
    });

    window.addReaction = async function(emoji) {
        if (!selectedMessageId) return;
        const { data } = await supabase.from('messages').select('reactions').eq('id', selectedMessageId).single();
        let reactions = data?.reactions || {};
        reactions[emoji] = (reactions[emoji] || 0) + 1;

        await supabase.from('messages').update({ reactions }).eq('id', selectedMessageId);
        document.getElementById('context-menu').style.display = 'none';
        loadGlobalMessages();
    };

    // --- Messages & Chat ---
    async function loadGlobalMessages() {
        const { data, error } = await supabase.from('messages').select('*').is('room_id', null).order('created_at', { ascending: true });
        if (error) return;

        const box = document.getElementById('chat-box');
        box.innerHTML = '';
        data.forEach(msg => renderMessage(msg, box));
        box.scrollTop = box.scrollHeight;
    }

    function renderMessage(msg, container) {
        const isMe = msg.sender_email === currentUser?.email;
        const div = document.createElement('div');
        div.className = `message-bubble ${isMe ? 'msg-me' : 'msg-other'}`;
        div.onclick = () => openContextMenu(msg.id);

        let content = `<div style="font-size:11px; font-weight:bold; opacity:0.8; margin-bottom:4px;">${msg.sender_email}</div>`;
        
        if (msg.reply_to_id) {
            content += `<div class="reply-quote">↩️ رد على رسالة مقتبسة</div>`;
        }

        if (msg.text) content += `<div>${msg.text}</div>`;
        if (msg.media_url) {
            if (msg.media_type === 'image') content += `<img src="${msg.media_url}" style="max-width:100%; border-radius:10px; margin-top:5px;">`;
            else if (msg.media_type === 'audio') content += `<audio controls src="${msg.media_url}" style="width:100%; margin-top:5px;"></audio>`;
            else content += `<a href="${msg.media_url}" target="_blank" style="color:inherit; text-decoration:underline;">📁 ملف مرفق</a>`;
        }

        if (msg.reactions && Object.keys(msg.reactions).length > 0) {
            let rxHtml = '<div class="reaction-badges">';
            for (let [emoji, count] of Object.entries(msg.reactions)) {
                rxHtml += `<span>${emoji} ${count}</span>`;
            }
            rxHtml += '</div>';
            content += rxHtml;
        }

        div.innerHTML = content;
        container.appendChild(div);
    }

    async function sendMessage(inputElem, mediaUrl = null, mediaType = null, roomId = null) {
        const text = inputElem.value.trim();
        if (!text && !mediaUrl) return;

        const payload = {
            sender_email: currentUser.email,
            text: text,
            media_url: mediaUrl,
            media_type: mediaType,
            room_id: roomId,
            reply_to_id: currentReplyId
        };

        await supabase.from('messages').insert([payload]);
        inputElem.value = '';
        currentReplyId = null;
        document.getElementById('reply-preview').style.display = 'none';
        if (!roomId) loadGlobalMessages();
    }

    document.getElementById('btn-send-chat').addEventListener('click', () => {
        sendMessage(document.getElementById('chat-input'));
    });

    // --- Realtime ---
    function subscribeRealtime() {
        supabase.channel('public:messages')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
                if (!payload.new.room_id) loadGlobalMessages();
            }).subscribe();
    }

    // --- Meetings (Jitsi) ---
    function startMeeting(roomName) {
        document.getElementById('meeting-modal').style.display = 'flex';
        const domain = 'meet.jit.si';
        const options = {
            roomName: 'Loome_' + roomName,
            width: '100%',
            height: '100%',
            parentNode: document.getElementById('jitsi-container'),
            userInfo: { displayName: currentUser.email }
        };
        jitsiApi = new JitsiMeetExternalAPI(domain, options);
    }

    document.getElementById('btn-start-global-meeting').addEventListener('click', () => startMeeting('Global_Room'));
    document.getElementById('btn-close-meeting').addEventListener('click', () => {
        if (jitsiApi) jitsiApi.dispose();
        document.getElementById('meeting-modal').style.display = 'none';
    });

    // --- Rooms Management ---
    const btnOpenCreate = document.getElementById('btn-open-create-room');
    const createModal = document.getElementById('create-room-modal');
    
    btnOpenCreate.addEventListener('click', () => createModal.style.display = 'flex');
    document.getElementById('btn-cancel-room').addEventListener('click', () => createModal.style.display = 'none');

    document.getElementById('btn-save-room').addEventListener('click', async () => {
        const roomName = document.getElementById('new-room-name').value.trim();
        if (!roomName) return;

        const { data } = await supabase.from('rooms').insert([{ name: roomName, owner_email: currentUser.email }]).select();
        if (data) {
            await supabase.from('room_members').insert([{ room_id: data[0].id, user_email: currentUser.email, status: 'approved' }]);
        }
        createModal.style.display = 'none';
        loadRooms();
    });

    async function loadRooms() {
        const { data: rooms } = await supabase.from('rooms').select('*');
        const listContainer = document.getElementById('rooms-list');
        listContainer.innerHTML = '';

        rooms?.forEach(room => {
            const div = document.createElement('div');
            div.className = 'room-card';
            div.innerHTML = `
                <div>
                    <strong>${room.name}</strong>
                    <div style="font-size:11px; color:#64748b;">المالك: ${room.owner_email}</div>
                </div>
                <div>
                    ${room.owner_email === currentUser.email ? 
                        `<button onclick="deleteRoom('${room.id}')" style="background:#ef4444; color:white; border:none; padding:6px 10px; border-radius:8px; cursor:pointer; margin-left:5px;">حذف</button>` : ''}
                    <button onclick="enterRoom('${room.id}', '${room.name}', '${room.owner_email}')" style="background:var(--primary-grad); color:white; border:none; padding:6px 12px; border-radius:8px; cursor:pointer;">دخول</button>
                </div>
            `;
            listContainer.appendChild(div);
        });
    }

    window.deleteRoom = async function(roomId) {
        if (!confirm("هل أنت تأكد من حذف الغرفة نهائياً؟")) return;
        await supabase.from('rooms').delete().eq('id', roomId);
        loadRooms();
    };

    window.enterRoom = function(roomId, roomName, ownerEmail) {
        currentRoomId = roomId;
        document.getElementById('rooms-list-container').style.display = 'none';
        document.getElementById('active-room-container').style.display = 'flex';
        document.getElementById('btn-back-rooms').style.display = 'inline-block';
        document.getElementById('room-view-title').innerText = `🔒 غرفة: ${roomName}`;
    };

    document.getElementById('btn-back-rooms').addEventListener('click', () => {
        document.getElementById('rooms-list-container').style.display = 'block';
        document.getElementById('active-room-container').style.display = 'none';
        document.getElementById('btn-back-rooms').style.display = 'none';
        document.getElementById('room-view-title').innerText = `🔒 الغرف الخاصة`;
    });
});
