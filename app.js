document.addEventListener('DOMContentLoaded', () => {
    const client = window.supabaseClient || window.supabase;

    const authForm = document.getElementById('auth-form');
    const authTitle = document.getElementById('auth-title');
    const btnSubmit = document.getElementById('btn-submit');
    const toggleAuth = document.getElementById('toggle-auth');
    const toggleMsg = document.getElementById('toggle-msg');
    const authError = document.getElementById('auth-error');
    const btnAnon = document.getElementById('btn-anon');

    const authContainer = document.getElementById('auth-container');
    const mainContent = document.getElementById('main-content');
    const btnLogout = document.getElementById('btn-logout');

    let currentUser = null;
    let isSignUp = false;

    if (toggleAuth) {
        toggleAuth.addEventListener('click', (e) => {
            e.preventDefault();
            isSignUp = !isSignUp;
            authTitle.textContent = isSignUp ? "إنشاء حساب جديد" : "تسجيل الدخول";
            btnSubmit.textContent = isSignUp ? "إنشاء حساب" : "تسجيل الدخول";
            toggleMsg.textContent = isSignUp ? "لديك حساب بالفعل؟" : "ليس لديك حساب؟";
            toggleAuth.textContent = isSignUp ? "تسجيل الدخول" : "إنشاء حساب جديد";
            authError.style.display = 'none';
        });
    }

    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            authError.style.display = 'none';
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            try {
                if (isSignUp) {
                    const { data, error } = await client.auth.signUp({ email, password });
                    if (error) throw error;
                    alert("تم إنشاء الحساب بنجاح!");
                    showMainContent();
                } else {
                    const { data, error } = await client.auth.signInWithPassword({ email, password });
                    if (error) throw error;
                    showMainContent();
                }
            } catch (err) {
                authError.textContent = err.message || "حدث خطأ أثناء الاتصال";
                authError.style.display = 'block';
            }
        });
    }

    if (btnAnon) {
        btnAnon.addEventListener('click', async () => {
            authError.style.display = 'none';
            try {
                if (client && client.auth && client.auth.signInAnonymously) {
                    await client.auth.signInAnonymously();
                } else {
                    const anonEmail = `guest_${Date.now()}@loome.com`;
                    const anonPass = "Guest123456!";
                    await client.auth.signUp({ email: anonEmail, password: anonPass });
                }
                showMainContent();
            } catch (err) {
                authError.textContent = err.message || "فشل الدخول كزائر";
                authError.style.display = 'block';
            }
        });
    }

    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            await client.auth.signOut();
            authContainer.style.display = 'block';
            mainContent.style.display = 'none';
        });
    }

    async function showMainContent() {
        const { data: { user } } = await client.auth.getUser();
        currentUser = user;

        authContainer.style.display = 'none';
        mainContent.style.display = 'flex';
        fetchPosts();
        fetchMessages();
        subscribeToMessages();
    }

    // --- إدارة المنشورات ---
    async function fetchPosts() {
        const postsContainer = document.getElementById('posts-container');
        if (!postsContainer) return;

        const { data: posts, error } = await client.from('posts').select('*').order('created_at', { ascending: false });

        if (error) {
            postsContainer.innerHTML = "<p style='color:red;'>خطأ في تحميل المنشورات</p>";
            return;
        }

        if (!posts || posts.length === 0) {
            postsContainer.innerHTML = "<p style='color:#888;'>لا توجد منشورات بعد.</p>";
            return;
        }

        postsContainer.innerHTML = posts.map(post => `
            <div class="post-card">
                <p style="font-size: 15px; color: #1c1e21;">${post.content}</p>
                <small style="color: #65676b; margin-top: 8px; display: block;">${new Date(post.created_at).toLocaleString('ar-EG')}</small>
            </div>
        `).join('');
    }

    const btnPost = document.getElementById('btn-post');
    if (btnPost) {
        btnPost.addEventListener('click', async () => {
            const input = document.getElementById('post-input');
            const content = input.value.trim();
            if (!content) return;

            const { error } = await client.from('posts').insert([{ content: content, user_id: currentUser ? currentUser.id : null }]);
            if (!error) {
                input.value = '';
                fetchPosts();
            }
        });
    }

    // --- إدارة الدردشة الجماعية الاحترافية ---
    async function fetchMessages() {
        const chatBox = document.getElementById('chat-box');
        if (!chatBox) return;

        const { data: messages, error } = await client
            .from('messages')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) {
            chatBox.innerHTML = "<p style='color:red;'>خطأ في تحميل الرسائل</p>";
            return;
        }

        if (!messages || messages.length === 0) {
            chatBox.innerHTML = "<p style='color:#888; text-align:center;'>لا توجد رسائل بعد. ابدأ المحادثة الآن!</p>";
            return;
        }

        const myEmail = currentUser ? (currentUser.email || 'زائر') : 'زائر';

        chatBox.innerHTML = messages.map(msg => {
            const isMe = msg.sender_email === myEmail;
            return `
                <div class="message-bubble ${isMe ? 'msg-me' : 'msg-other'}">
                    <div class="msg-author">${isMe ? 'أنت' : (msg.sender_email || 'زائر')}</div>
                    <div>${msg.content}</div>
                </div>
            `;
        }).join('');

        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function subscribeToMessages() {
        client
            .channel('public:messages')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
                fetchMessages();
            })
            .subscribe();
    }

    const btnSendChat = document.getElementById('btn-send-chat');
    if (btnSendChat) {
        btnSendChat.addEventListener('click', async () => {
            const input = document.getElementById('chat-input');
            const content = input.value.trim();
            if (!content) return;

            const senderEmail = currentUser ? (currentUser.email || 'زائر') : 'زائر';
            const userId = currentUser ? currentUser.id : null;

            const { error } = await client.from('messages').insert([{
                content: content,
                user_id: userId,
                sender_email: senderEmail
            }]);

            if (!error) {
                input.value = '';
                fetchMessages();
            }
        });
    }

    async function checkUser() {
        if (!client) return;
        const { data: { user } } = await client.auth.getUser();
        if (user) {
            showMainContent();
        }
    }

    checkUser();
});
