// i18n.js - إدارة الترجمة للغات متعددة

const translations = {
  ar: {
    appName: "لومي سبيس",
    login: "تسجيل الدخول",
    register: "إنشاء حساب جديد",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    username: "اسم المستخدم",
    fullName: "الاسم الكامل",
    feed: "الرئيسية",
    groups: "المجموعات",
    messages: "الرسائل",
    profile: "الملف الشخصي",
    postPlaceholder: "بماذا تفكر اليوم؟",
    publish: "نشر",
    logout: "تسجيل الخروج",
    noPosts: "لا توجد منشورات حتى الآن."
  },
  en: {
    appName: "Loome Social",
    login: "Log In",
    register: "Sign Up",
    email: "Email Address",
    password: "Password",
    username: "Username",
    fullName: "Full Name",
    feed: "Home",
    groups: "Groups",
    messages: "Messages",
    profile: "Profile",
    postPlaceholder: "What's on your mind?",
    publish: "Post",
    logout: "Log Out",
    noPosts: "No posts yet."
  },
  fr: {
    appName: "Loome Social",
    login: "Connexion",
    register: "S'inscrire",
    email: "Adresse e-mail",
    password: "Mot de passe",
    username: "Nom d'utilisateur",
    fullName: "Nom complet",
    feed: "Accueil",
    groups: "Groupes",
    messages: "Messages",
    profile: "Profil",
    postPlaceholder: "À quoi pensez-vous ?",
    publish: "Publier",
    logout: "Déconnexion",
    noPosts: "Aucune publication pour le moment."
  },
  ru: {
    appName: "Loome Social",
    login: "Войти",
    register: "Регистрация",
    email: "Электронная почта",
    password: "Пароль",
    username: "Имя пользователя",
    fullName: "Полное имя",
    feed: "Главная",
    groups: "Группы",
    messages: "Сообщения",
    profile: "Профиль",
    postPlaceholder: "О чем вы думаете?",
    publish: "Опубликовать",
    logout: "Выйти",
    noPosts: "Пока нет публикаций."
  },
  zh: {
    appName: "Loome Social",
    login: "登录",
    register: "注册",
    email: "电子邮件",
    password: "密码",
    username: "用户名",
    fullName: "全名",
    feed: "首页",
    groups: "小组",
    messages: "消息",
    profile: "个人资料",
    postPlaceholder: "在想什么呢？",
    publish: "发布",
    logout: "退出登录",
    noPosts: "暂无动态。"
  },
  de: {
    appName: "Loome Social",
    login: "Anmelden",
    register: "Registrieren",
    email: "E-Mail-Adresse",
    password: "Passwort",
    username: "Benutzername",
    fullName: "Vollständiger Name",
    feed: "Startseite",
    groups: "Gruppen",
    messages: "Nachrichten",
    profile: "Profil",
    postPlaceholder: "Was geht dir durch den Kopf?",
    publish: "Veröffentlichen",
    logout: "Abmelden",
    noPosts: "Noch keine Beiträge."
  }
};

// اللغة الافتراضية
let currentLang = localStorage.getItem('app_lang') || 'ar';

function setLanguage(lang) {
  if (!translations[lang]) return;
  
  currentLang = lang;
  localStorage.setItem('app_lang', lang);
  
  // ضبط الاتجاه (يمين لليسار للعربية فقط، والباقتي يسار لليمين)
  document.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
  
  updateUI();
}

function t(key) {
  return translations[currentLang][key] || key;
}

function updateUI() {
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    if (element.tagName === 'INPUT' && element.placeholder) {
      element.placeholder = t(key);
    } else {
      element.textContent = t(key);
    }
  });
}

// تطبيق اللغة عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
  setLanguage(currentLang);
});
