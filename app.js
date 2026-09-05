document.addEventListener('DOMContentLoaded', () => {
    const client = window.supabaseClient || window.supabase;

    let currentUser = null;
    let activeVideoTarget = null; // chat أو dm
    let mediaRecorder = null;
    let chunks = [];
    let videoStream = null;

    // تسجيل الدخول والخروج
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
        const anonEmail = `guest_${Date.now()}@loome.com`;
        await client.auth.signUp({ email: anonEmail, password: "Guest123456!" });
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
        fetchPosts();
        
        // الاستماع الفوري لرسائل الدردشة العامة
        client.channel('chat-room').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, fetchChat).subscribe();
    }

    // --- معالجة صيغ الوسائط (صوت - صورة - فيديو) ---
    function renderMediaContent(content) {
        if (content.startsWith('[AUDIO]:')) {
            return `<audio controls src="${content.replace('[AUDIO]:', '')}" style="max-width:100%; height:35px;"></audio>`;
        }
        if (content.startsWith('[IMAGE]:')) {
            return `<img src="${content.replace('[IMAGE]:', '')}" style="max-width:100%; border-radius:8px;">`;
        }
        if (content.startsWith('[VIDEO]:')) {
            return `<video controls src="${content.replace('[VIDEO]:', '')}" style="max-width:100%; border-radius:8px;"></video>`;
        }
        return `<div>${content}</div>`;
    }

    // --- 1. الدردشة الجماعية ---
    async function fetchChat() {
        const box = document.getElementById('chat-box');
        const { data } = await client.from('messages').select('*').order('created_at', { ascending: true });
        if (!data) return;

        const myEmail = currentUser ? (currentUser.email || 'زائر') : 'زائر';
        box.innerHTML = data.map(m => `
            <div class="message-bubble ${m.sender_email === myEmail ? 'msg-me' : 'msg-other'}">
                <div style="font-size:10px; opacity:0.8;">${m.sender_email === myEmail ? 'أنت' : m.sender_email}</div>
                ${renderMediaContent(m.content)}
            </div>
        `).join('');
        box.scrollTop = box.scrollHeight;
    }

    document.getElementById('btn-send-chat').addEventListener('click', async () => {
        const input = document.getElementById('chat-input');
        if (!input.value.trim()) return;
        await client.from('messages').insert([{ content: input.value.trim(), sender_email: currentUser?.email || 'زائر' }]);
        input.value = '';
    });

    // رفع ملفات بالدردشة
    document.getElementById('chat-file-input').addEventListener('change', (e) => uploadAndSend(e.target.files[0], 'chat'));

    // --- 2. الرسائل الخاصة ---
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

        box.innerHTML = (data || []).map(m => `
            <div class="message-bubble ${m.sender_email === myEmail ? 'msg-me' : 'msg-other'}">
                ${renderMediaContent(m.content)}
            </div>
        `).join('');
        box.scrollTop = box.scrollHeight;
    }

    document.getElementById('btn-send-dm').addEventListener('click', async () => {
        const input = document.getElementById('dm-input');
        const target = dmTarget.value.trim();
        if (!input.value.trim() || !target) return alert("أدخل بريد المستلم ورسالتك");

        await client.from('direct_messages').insert([{ content: input.value.trim(), sender_email: currentUser?.email || 'زائر', receiver_email: target }]);
        input.value = '';
        fetchDM();
    });

    document.getElementById('dm-file-input').addEventListener('change', (e) => uploadAndSend(e.target.files[0], 'dm'));

    // --- 3. المنشورات العامة ---
    let pendingPostMedia = null;
    document.getElementById('post-file-input').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const bucket = file.type.startsWith('image/') ? 'chat-images' : 'chat-videos';
        const name = `post_${Date.now()}_${file.name}`;
        
        document.getElementById('post-file-status').innerText = "جاري رفع الملف...";
        const { error } = await client.storage.from(bucket).upload(name, file);
        if (!error) {
            const url = client.storage.from(bucket).getPublicUrl(name).data.publicUrl;
            pendingPostMedia = `${file.type.startsWith('image/') ? '[IMAGE]:' : '[VIDEO]:'}${url}`;
            document.getElementById('post-file-status').innerText = "تم إرفاق الملف ✓";
        }
    });

    document.getElementById('btn-send-post').addEventListener('click', async () => {
        const input = document.getElementById('post-input');
        let text = input.value.trim();
        if (!text && !pendingPostMedia) return;

        if (pendingPostMedia) text = `${text} ${pendingPostMedia}`;
        await client.from('posts').insert([{ content: text, user_id: currentUser?.id }]);
        input.value = '';
        pendingPostMedia = null;
        document.getElementById('post-file-status').innerText = '';
        fetchPosts();
    });

    async function fetchPosts() {
        const box = document.getElementById('posts-box');
        const { data } = await client.from('posts').select('*').order('created_at', { ascending: false });
        if (!data) return;

        box.innerHTML = data.map(p => `
            <div style="background:#fff; padding:10px; border-radius:8px; border:1px solid #e4e6eb;">
                ${renderMediaContent(p.content)}
            </div>
        `).join('');
    }

    // --- وظيفة الرفع العامة ---
    async function uploadAndSend(file, type) {
        if (!file) return;
        const isImg = file.type.startsWith('image/');
        const bucket = isImg ? 'chat-images' : 'chat-videos';
        const name = `${type}_${Date.now()}_${file.name}`;

        const { error } = await client.storage.from(bucket).upload(name, file);
        if (error) return alert("فشل الرفع: " + error.message);

        const url = client.storage.from(bucket).getPublicUrl(name).data.publicUrl;
        const formatted = `${isImg ? '[IMAGE]:' : '[VIDEO]:'}${url}`;

        if (type === 'chat') {
            await client.from('messages').insert([{ content: formatted, sender_email: currentUser?.email || 'زائر' }]);
            fetchChat();
        } else if (type === 'dm') {
            const target = dmTarget.value.trim();
            if (!target) return alert("أدخل بريد المستلم");
            await client.from('direct_messages').insert([{ content: formatted, sender_email: currentUser?.email || 'زائر', receiver_email: target }]);
            fetchDM();
        }
    }

    // --- التسجيل الصوتي المباشر (لشاشة Chat و DM) ---
    function setupMic(btnId, targetType) {
        const btn = document.getElementById(btnId);
        btn.addEventListener('click', async () => {
            if (!mediaRecorder || mediaRecorder.state === 'inactive') {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                chunks = [];
                mediaRecorder.ondataavailable = e => chunks.push(e.data);
                mediaRecorder.onstop = async () => {
                    const blob = new Blob(chunks, { type: 'audio/webm' });
                    const name = `audio_${Date.now()}.webm`;
                    await client.storage.from('audio-messages').upload(name, blob);
                    const url = client.storage.from('audio-messages').getPublicUrl(name).data.publicUrl;
                    const formatted = `[AUDIO]:${url}`;

                    if (targetType === 'chat') {
                        await client.from('messages').insert([{ content: formatted, sender_email: currentUser?.email || 'زائر' }]);
                        fetchChat();
                    } else {
                        const target = dmTarget.value.trim();
                        if (target) {
                            await client.from('direct_messages').insert([{ content: formatted, sender_email: currentUser?.email || 'زائر', receiver_email: target }]);
                            fetchDM();
                        }
                    }
                    btn.style.background = '#28a745';
                };
                mediaRecorder.start();
                btn.style.background = '#dc3545';
            } else {
                mediaRecorder.stop();
            }
        });
    }

    setupMic('btn-chat-mic', 'chat');
    setupMic('btn-dm-mic', 'dm');

    // --- تسجيل الفيديو المباشر من الكاميرا ---
    const videoModal = document.getElementById('video-modal');
    const videoPreview = document.getElementById('video-preview');

    document.getElementById('btn-chat-cam').addEventListener('click', async () => {
        try {
            videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            videoPreview.srcObject = videoStream;
            videoModal.style.display = 'flex';

            chunks = [];
            mediaRecorder = new MediaRecorder(videoStream);
            mediaRecorder.ondataavailable = e => chunks.push(e.data);
            mediaRecorder.onstop = async () => {
                const blob = new Blob(chunks, { type: 'video/webm' });
                const name = `cam_${Date.now()}.webm`;
                await client.storage.from('chat-videos').upload(name, blob);
                const url = client.storage.from('chat-videos').getPublicUrl(name).data.publicUrl;

                await client.from('messages').insert([{ content: `[VIDEO]:${url}`, sender_email: currentUser?.email || 'زائر' }]);
                fetchChat();
                closeCam();
            };
            mediaRecorder.start();
        } catch (err) {
            alert("يرجى إعطاء إذن استخدام الكاميرا والميكروفون.");
        }
    });

    document.getElementById('btn-stop-video').addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    });

    document.getElementById('btn-cancel-video').addEventListener('click', closeCam);

    function closeCam() {
        if (videoStream) videoStream.getTracks().forEach(t => t.stop());
        videoModal.style.display = 'none';
    }

    // التحقق المباشر من وجود جلسة
    (async () => {
        const { data: { user } } = await client.auth.getUser();
        if (user) initApp();
    })();
});
