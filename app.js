document.addEventListener('DOMContentLoaded', () => {
    const client = window.supabaseClient || window.supabase;

    let currentUser = null;
    let selectedItem = null; // يحفظ بيانات العنصر المختار عند الضغط المطول
    let activeRoom = null;
    let mediaRecorder = null;
    let chunks = [];
    let jitsiApi = null;

    // --- تسجيل الدخول والزائر ---
    const authForm = document.getElementById('auth-form');
    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const { error } = await client.auth.signInWithPassword({ email, password });
            if (error) alert(error.message);
            else initApp();
        });
    }

    document.getElementById('btn-anon').addEventListener('click', async () => {
        const anonEmail = `visitor_${Math.floor(Math.random() * 10000)}@loome.com`;
        await client.auth.signUp({ email: anonEmail, password: "Visitor123456!" });
        initApp();
    });

    document.getElementById('btn-logout').addEventListener('click', async () => {
        await client.auth.signOut();
        location.reload();
    });

    async function initApp() {
        const { data: { user } } = await client.auth.getUser();
        currentUser = user;
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('main-content').style.display = 'flex';

        fetchChat();
        fetchRooms();
        fetchPosts();

        // تحديثات فورية
        client.channel('chat-room').on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, fetchChat).subscribe();
    }

    // --- عرض محتوى الرسائل والملفات ---
    function renderMediaContent(content) {
        if (!content) return '';
        if (content.startsWith('[IMAGE]:')) return `<img src="${content.replace('[IMAGE]:', '')}" style="max-width:100%; border-radius:12px; margin-top:5px;">`;
        if (content.startsWith('[VIDEO]:')) return `<video controls src="${content.replace('[VIDEO]:', '')}" style="max-width:100%; border-radius:12px; margin-top:5px;"></video>`;
        if (content.startsWith('[AUDIO]:')) return `<audio controls src="${content.replace('[AUDIO]:', '')}" style="max-width:100%; height:35px; margin-top:5px;"></audio>`;
        if (content.startsWith('[FILE]:')) {
            const url = content.replace('[FILE]:', '');
            return `<a href="${url}" target="_blank" download style="display:inline-flex; align-items:center; gap:6px; padding:8px 12px; background:#edf2f7; border-radius:8px; text-decoration:none; color:#2b6cb0; font-weight:bold; font-size:12px; margin-top:5px;">📄 تحميل الملف</a>`;
        }
        return `<div>${content}</div>`;
    }

    // --- نظام الضغط المطول (Long Press) الشامل لكل محتوى ---
    window.attachLongPress = (element, id, table, content, isMe) => {
        let timer;
        const start = () => {
            timer = setTimeout(() => {
                if (isMe) openContextMenu(id, table, content);
            }, 500); // 500ms تعتبر ضغطة مطولة
        };
        const end = () => clearTimeout(timer);

        element.addEventListener('touchstart', start);
        element.addEventListener('touchend', end);
        element.addEventListener('mousedown', start);
        element.addEventListener('mouseup', end);
        element.addEventListener('mouseleave', end);
    };

    function openContextMenu(id, table, content) {
        selectedItem = { id, table, content };
        document.getElementById('context-menu').style.display = 'flex';
    }

    document.getElementById('ctx-cancel').addEventListener('click', () => {
        document.getElementById('context-menu').style.display = 'none';
    });

    document.getElementById('ctx-delete').addEventListener('click', async () => {
        document.getElementById('context-menu').style.display = 'none';
        if (!selectedItem || !confirm("هل أنت تأكد من رغبتك في حذف هذا المحتوى؟")) return;

        const { error } = await client.from(selectedItem.table).delete().eq('id', selectedItem.id);
        if (error) alert("خطأ الحذف: " + error.message);
        else refreshTab(selectedItem.table);
    });

    document.getElementById('ctx-edit').addEventListener('click', () => {
        document.getElementById('context-menu').style.display = 'none';
        if (!selectedItem) return;

        const isMedia = selectedItem.content.startsWith('[AUDIO]:') || selectedItem.content.startsWith('[IMAGE]:') || selectedItem.content.startsWith('[VIDEO]:') || selectedItem.content.startsWith('[FILE]:');
        if (isMedia) {
            document.getElementById('replace-file-input').click();
        } else {
            document.getElementById('edit-input').value = selectedItem.content;
            document.getElementById('edit-modal').style.display = 'flex';
        }
    });

    document.getElementById('btn-cancel-edit').addEventListener('click', () => {
        document.getElementById('edit-modal').style.display = 'none';
    });

    document.getElementById('btn-save-edit').addEventListener('click', async () => {
        const newText = document.getElementById('edit-input').value.trim();
        if (!newText || !selectedItem) return;

        await client.from(selectedItem.table).update({ content: newText }).eq('id', selectedItem.id);
        document.getElementById('edit-modal').style.display = 'none';
        refreshTab(selectedItem.table);
    });

    document.getElementById('replace-file-input').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !selectedItem) return;

        let bucket = 'chat-files';
        let prefix = '[FILE]:';

        if (file.type.startsWith('image/')) { bucket = 'chat-images'; prefix = '[IMAGE]:'; }
        else if (file.type.startsWith('video/')) { bucket = 'chat-videos'; prefix = '[VIDEO]:'; }
        else if (file.type.startsWith('audio/')) { bucket = 'audio-messages'; prefix = '[AUDIO]:'; }

        const fileName = `replaced_${Date.now()}_${file.name}`;
        await client.storage.from(bucket).upload(fileName, file);
        const url = client.storage.from(bucket).getPublicUrl(fileName).data.publicUrl;

        await client.from(selectedItem.table).update({ content: `${prefix}${url}` }).eq('id', selectedItem.id);
        refreshTab(selectedItem.table);
    });

    // --- 1. الدردشة العامة ---
    async function fetchChat() {
        const box = document.getElementById('chat-box');
        const { data } = await client.from('messages').select('*').order('created_at', { ascending: true });
        if (!data) return;

        const myEmail = currentUser?.email || 'زائر';
        box.innerHTML = '';
        data.forEach(m => {
            const isMe = m.sender_email === myEmail;
            const bubble = document.createElement('div');
            bubble.className = `message-bubble ${isMe ? 'msg-me' : 'msg-other'}`;
            bubble.innerHTML = `<div style="font-size:10px; opacity:0.8; margin-bottom:2px;">${isMe ? 'أنت' : m.sender_email}</div>${renderMediaContent(m.content)}`;
            
            attachLongPress(bubble, m.id, 'messages', m.content, isMe);
            box.appendChild(bubble);
        });
        box.scrollTop = box.scrollHeight;
    }

    document.getElementById('btn-send-chat').addEventListener('click', async () => {
        const input = document.getElementById('chat-input');
        if (!input.value.trim()) return;
        await client.from('messages').insert([{ content: input.value.trim(), sender_email: currentUser?.email || 'زائر' }]);
        input.value = '';
        fetchChat();
    });

    document.getElementById('chat-file-input').addEventListener('change', (e) => uploadAndSend(e.target.files[0], 'chat'));

    // --- 2. الغرف الخاصة والموافقة وحصريتها ---
    document.getElementById('btn-open-create-room').addEventListener('click', () => {
        document.getElementById('create-room-modal').style.display = 'flex';
    });
    document.getElementById('btn-cancel-room').addEventListener('click', () => {
        document.getElementById('create-room-modal').style.display = 'none';
    });

    document.getElementById('btn-save-room').addEventListener('click', async () => {
        const name = document.getElementById('new-room-name').value.trim();
        if (!name) return;

        const { data } = await client.from('rooms').insert([{ name, owner_email: currentUser?.email || 'زائر' }]).select();
        if (data && data[0]) {
            // إضافة صاحب الغرفة فوراً كعضو معتمد
            await client.from('room_members').insert([{ room_id: data[0].id, user_email: currentUser?.email || 'زائر', status: 'approved' }]);
        }

        document.getElementById('create-room-modal').style.display = 'none';
        document.getElementById('new-room-name').value = '';
        fetchRooms();
    });

    async function fetchRooms() {
        const box = document.getElementById('rooms-list');
        const { data } = await client.from('rooms').select('*').order('created_at', { ascending: false });
        if (!data) return;

        const myEmail = currentUser?.email || 'زائر';
        box.innerHTML = '';

        for (const r of data) {
            const isOwner = r.owner_email === myEmail;
            
            // التحقق من حالة العضوية
            const { data: memberData } = await client.from('room_members').select('status').eq('room_id', r.id).eq('user_email', myEmail).maybeSingle();
            const status = isOwner ? 'approved' : (memberData?.status || 'none');

            const div = document.createElement('div');
            div.className = 'room-card';
            div.innerHTML = `
                <div>
                    <h4>🔒 ${r.name}</h4>
                    <div style="font-size:11px; color:#718096;">المالك: ${isOwner ? 'أنت' : r.owner_email}</div>
                </div>
                <div>
                    ${status === 'approved' ? `<button onclick="enterRoom('${r.id}', '${r.name}', '${r.owner_email}')" style="padding:6px 14px; border-radius:10px; border:none; background:var(--primary-grad); color:white; font-weight:bold; cursor:pointer;">دخول الغرفة</button>` : ''}
                    ${status === 'pending' ? `<span style="font-size:12px; color:#dd6b20; font-weight:bold;">⏳ قيد الموافقة</span>` : ''}
                    ${status === 'none' ? `<button onclick="requestJoinRoom('${r.id}')" style="padding:6px 14px; border-radius:10px; border:none; background:#edf2f7; color:#2d3748; font-weight:bold; cursor:pointer;">طلب انضمام</button>` : ''}
                </div>
            `;
            box.appendChild(div);
        }
    }

    window.requestJoinRoom = async (roomId) => {
        await client.from('room_members').insert([{ room_id: roomId, user_email: currentUser?.email || 'زائر', status: 'pending' }]);
        alert("تم إرسال طلب الانضمام لصاحب الغرفة بنجاح!");
        fetchRooms();
    };

    window.enterRoom = (roomId, roomName, ownerEmail) => {
        activeRoom = { id: roomId, name: roomName, owner: ownerEmail };
        document.getElementById('rooms-list-container').style.display = 'none';
        document.getElementById('active-room-container').style.display = 'flex';
        document.getElementById('btn-back-rooms').style.display = 'inline-block';
        document.getElementById('room-view-title').innerText = `🔒 الغرفة: ${roomName}`;

        if (currentUser?.email === ownerEmail) {
            checkRoomRequests();
        } else {
            document.getElementById('room-requests-panel').style.display = 'none';
        }

        fetchRoomMessages();
    };

    document.getElementById('btn-back-rooms').addEventListener('click', () => {
        activeRoom = null;
        document.getElementById('active-room-container').style.display = 'none';
        document.getElementById('rooms-list-container').style.display = 'flex';
        document.getElementById('btn-back-rooms').style.display = 'none';
        document.getElementById('room-view-title').innerText = `🔒 الغرف الخاصة والسرية`;
        fetchRooms();
    });

    async function checkRoomRequests() {
        const { data } = await client.from('room_members').select('*').eq('room_id', activeRoom.id).eq('status', 'pending');
        const panel = document.getElementById('room-requests-panel');
        const list = document.getElementById('room-requests-list');

        if (data && data.length > 0) {
            panel.style.display = 'block';
            list.innerHTML = data.map(req => `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:5px; font-size:13px;">
                    <span>👤 ${req.user_email}</span>
                    <div>
                        <button onclick="approveMember('${req.id}', true)" style="background:#38a169; color:white; border:none; padding:3px 8px; border-radius:6px; cursor:pointer;">✅ قبول</button>
                        <button onclick="approveMember('${req.id}', false)" style="background:#e53e3e; color:white; border:none; padding:3px 8px; border-radius:6px; cursor:pointer;">❌ رفض</button>
                    </div>
                </div>
            `).join('');
        } else {
            panel.style.display = 'none';
        }
    }

    window.approveMember = async (memberId, accept) => {
        if (accept) {
            await client.from('room_members').update({ status: 'approved' }).eq('id', memberId);
        } else {
            await client.from('room_members').delete().eq('id', memberId);
        }
        checkRoomRequests();
    };

    async function fetchRoomMessages() {
        if (!activeRoom) return;
        const box = document.getElementById('room-chat-box');
        const { data } = await client.from('room_messages').select('*').eq('room_id', activeRoom.id).order('created_at', { ascending: true });
        if (!data) return;

        const myEmail = currentUser?.email || 'زائر';
        box.innerHTML = '';
        data.forEach(m => {
            const isMe = m.sender_email === myEmail;
            const bubble = document.createElement('div');
            bubble.className = `message-bubble ${isMe ? 'msg-me' : 'msg-other'}`;
            bubble.innerHTML = `<div style="font-size:10px; opacity:0.8; margin-bottom:2px;">${isMe ? 'أنت' : m.sender_email}</div>${renderMediaContent(m.content)}`;

            attachLongPress(bubble, m.id, 'room_messages', m.content, isMe);
            box.appendChild(bubble);
        });
        box.scrollTop = box.scrollHeight;
    }

    document.getElementById('btn-send-room-chat').addEventListener('click', async () => {
        const input = document.getElementById('room-chat-input');
        if (!input.value.trim() || !activeRoom) return;
        await client.from('room_messages').insert([{ room_id: activeRoom.id, content: input.value.trim(), sender_email: currentUser?.email || 'زائر' }]);
        input.value = '';
        fetchRoomMessages();
    });

    document.getElementById('room-file-input').addEventListener('change', (e) => uploadAndSend(e.target.files[0], 'room'));

    // --- 3. الرسائل الخاصة ---
    const dmTarget = document.getElementById('dm-target-email');
    dmTarget.addEventListener('change', fetchDM);

    async function fetchDM() {
        const target = dmTarget.value.trim();
        const box = document.getElementById('dm-box');
        if (!target) return;

        const myEmail = currentUser?.email || 'زائر';
        const { data } = await client.from('direct_messages').select('*')
            .or(`and(sender_email.eq.${myEmail},receiver_email.eq.${target}),and(sender_email.eq.${target},receiver_email.eq.${myEmail})`)
            .order('created_at', { ascending: true });

        box.innerHTML = '';
        (data || []).forEach(m => {
            const isMe = m.sender_email === myEmail;
            const bubble = document.createElement('div');
            bubble.className = `message-bubble ${isMe ? 'msg-me' : 'msg-other'}`;
            bubble.innerHTML = renderMediaContent(m.content);

            attachLongPress(bubble, m.id, 'direct_messages', m.content, isMe);
            box.appendChild(bubble);
        });
        box.scrollTop = box.scrollHeight;
    }

    document.getElementById('btn-send-dm').addEventListener('click', async () => {
        const input = document.getElementById('dm-input');
        const target = dmTarget.value.trim();
        if (!input.value.trim() || !target) return;

        await client.from('direct_messages').insert([{ content: input.value.trim(), sender_email: currentUser?.email || 'زائر', receiver_email: target }]);
        input.value = '';
        fetchDM();
    });

    document.getElementById('dm-file-input').addEventListener('change', (e) => uploadAndSend(e.target.files[0], 'dm'));

    // --- 4. المنشورات العامة ---
    document.getElementById('post-file-input').addEventListener('change', (e) => uploadAndSend(e.target.files[0], 'post'));

    document.getElementById('btn-send-post').addEventListener('click', async () => {
        const input = document.getElementById('post-input');
        if (!input.value.trim()) return;

        await client.from('posts').insert([{ content: input.value.trim(), user_id: currentUser?.id, sender_email: currentUser?.email || 'زائر' }]);
        input.value = '';
        fetchPosts();
    });

    async function fetchPosts() {
        const box = document.getElementById('posts-box');
        const { data } = await client.from('posts').select('*').order('created_at', { ascending: false });
        if (!data) return;

        const myEmail = currentUser?.email || 'زائر';
        box.innerHTML = '';
        data.forEach(p => {
            const isMe = p.sender_email === myEmail || p.user_id === currentUser?.id;
            const card = document.createElement('div');
            card.style.cssText = "background:#ffffff; padding:15px; border-radius:12px; border:1px solid var(--border); position:relative;";
            card.innerHTML = `<div style="font-size:12px; font-weight:bold; color:#4a5568; margin-bottom:6px;">${p.sender_email}</div>${renderMediaContent(p.content)}`;

            attachLongPress(card, p.id, 'posts', p.content, isMe);
            box.appendChild(card);
        });
    }

    // --- الاجتماع المرئي والصوتي الحي ---
    document.getElementById('btn-start-global-meeting').addEventListener('click', () => startMeeting('Loome-Global'));
    document.getElementById('btn-start-room-meeting').addEventListener('click', () => {
        if (activeRoom) startMeeting(`Room_${activeRoom.name}`);
    });
    document.getElementById('btn-close-meeting').addEventListener('click', closeMeeting);

    function startMeeting(roomName) {
        document.getElementById('meeting-modal').style.display = 'flex';
        document.getElementById('meeting-title').innerText = `📹 اجتماع حي: ${roomName}`;

        const options = {
            roomName: `LoomeMeeting_${roomName.replace(/\s+/g, '_')}`,
            width: '100%',
            height: '100%',
            parentNode: document.querySelector('#jitsi-container'),
            userInfo: { displayName: currentUser?.email || 'زائر Loome' }
        };
        document.querySelector('#jitsi-container').innerHTML = '';
        jitsiApi = new JitsiMeetExternalAPI('meet.jit.si', options);
    }

    function closeMeeting() {
        if (jitsiApi) jitsiApi.dispose();
        document.getElementById('meeting-modal').style.display = 'none';
    }

    // --- الميكروفون التسجيل الصوتي المباشر ---
    function setupMic(btnId, targetType) {
        const btn = document.getElementById(btnId);
        if (!btn) return;

        btn.addEventListener('click', async () => {
            if (!mediaRecorder || mediaRecorder.state === 'inactive') {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    mediaRecorder = new MediaRecorder(stream);
                    chunks = [];
                    mediaRecorder.ondataavailable = e => chunks.push(e.data);
                    mediaRecorder.onstop = async () => {
                        const blob = new Blob(chunks, { type: 'audio/webm' });
                        const fileName = `voice_${Date.now()}.webm`;

                        await client.storage.from('audio-messages').upload(fileName, blob);
                        const url = client.storage.from('audio-messages').getPublicUrl(fileName).data.publicUrl;
                        const formatted = `[AUDIO]:${url}`;

                        if (targetType === 'chat') {
                            await client.from('messages').insert([{ content: formatted, sender_email: currentUser?.email || 'زائر' }]);
                            fetchChat();
                        } else if (targetType === 'room' && activeRoom) {
                            await client.from('room_messages').insert([{ room_id: activeRoom.id, content: formatted, sender_email: currentUser?.email || 'زائر' }]);
                            fetchRoomMessages();
                        } else if (targetType === 'dm') {
                            const target = dmTarget.value.trim();
                            if (target) {
                                await client.from('direct_messages').insert([{ content: formatted, sender_email: currentUser?.email || 'زائر', receiver_email: target }]);
                                fetchDM();
                            }
                        } else if (targetType === 'post') {
                            await client.from('posts').insert([{ content: formatted, user_id: currentUser?.id, sender_email: currentUser?.email || 'زائر' }]);
                            fetchPosts();
                        }
                        btn.style.background = '#28a745';
                    };
                    mediaRecorder.start();
                    btn.style.background = '#dc3545';
                } catch (err) { alert("يرجى تفعيل الميكروفون."); }
            } else { mediaRecorder.stop(); }
        });
    }

    setupMic('btn-chat-mic', 'chat');
    setupMic('btn-room-mic', 'room');
    setupMic('btn-dm-mic', 'dm');
    setupMic('btn-post-mic', 'post');

    // --- رفع وتحديث الملفات العامة ---
    async function uploadAndSend(file, type) {
        if (!file) return;

        let bucket = 'chat-files';
        let prefix = '[FILE]:';

        if (file.type.startsWith('image/')) { bucket = 'chat-images'; prefix = '[IMAGE]:'; }
        else if (file.type.startsWith('video/')) { bucket = 'chat-videos'; prefix = '[VIDEO]:'; }
        else if (file.type.startsWith('audio/')) { bucket = 'audio-messages'; prefix = '[AUDIO]:'; }

        const fileName = `${type}_${Date.now()}_${file.name}`;
        await client.storage.from(bucket).upload(fileName, file);
        const url = client.storage.from(bucket).getPublicUrl(fileName).data.publicUrl;
        const formatted = `${prefix}${url}`;

        if (type === 'chat') {
            await client.from('messages').insert([{ content: formatted, sender_email: currentUser?.email || 'زائر' }]);
            fetchChat();
        } else if (type === 'room' && activeRoom) {
            await client.from('room_messages').insert([{ room_id: activeRoom.id, content: formatted, sender_email: currentUser?.email || 'زائر' }]);
            fetchRoomMessages();
        } else if (type === 'dm') {
            const target = dmTarget.value.trim();
            if (target) {
                await client.from('direct_messages').insert([{ content: formatted, sender_email: currentUser?.email || 'زائر', receiver_email: target }]);
                fetchDM();
            }
        } else if (type === 'post') {
            await client.from('posts').insert([{ content: formatted, user_id: currentUser?.id, sender_email: currentUser?.email || 'زائر' }]);
            fetchPosts();
        }
    }

    function refreshTab(table) {
        if (table === 'messages') fetchChat();
        if (table === 'room_messages') fetchRoomMessages();
        if (table === 'direct_messages') fetchDM();
        if (table === 'posts') fetchPosts();
    }

    (async () => {
        const { data: { user } } = await client.auth.getUser();
        if (user) initApp();
    })();
});
