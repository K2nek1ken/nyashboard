// ================== NyashBoard CONFIG ==================

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDCedqp2DepypYRYq6gotunLl4G8dZDD-4",
  authDomain: "nyashboard.firebaseapp.com",
  projectId: "nyashboard",
  storageBucket: "nyashboard.firebasestorage.app",
  messagingSenderId: "1041856249473",
  appId: "1:1041856249473:web:85eb7b85fec32859019780",
  measurementId: "G-DEWHE9VQMM"
};

// Бесплатный ключ с https://api.imgbb.com/ — без него imgbb просто пропускается
// в цепочке ниже, остальные хосты ключей не требуют вообще.
export const IMGBB_API_KEY = "25226063b3d3709d3bd35d3924a85e4c";

// Цепочка хостингов картинок: пробуются по очереди сверху вниз, первый
// сработавший побеждает. Если сервис отвалился (лимит/недоступен/CORS) —
// автоматически берётся следующий.
//   imgbb  — быстрый, нужен ключ, есть суточные лимиты
//   catbox — без ключей и регистрации, файлы хранятся постоянно
//   uguu   — без ключей, но файлы живут ~час; поэтому он последний, на самый край
// Firebase Storage тут намеренно нет: с конца 2024 Google требует привязанный
// биллинг (тариф Blaze) даже просто чтобы создать бакет.
export const IMAGE_HOSTS = ["imgbb", "catbox", "uguu"];
