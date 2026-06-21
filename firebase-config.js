// Ключи проекта cloudme уже вставлены ниже — менять не нужно.

const firebaseConfig = {
  apiKey: "AIzaSyAcR6foa4sRaA2Pu4rpxKLukvzllmxrWus",
  authDomain: "cloudme-3e936.firebaseapp.com",
  projectId: "cloudme-3e936",
  storageBucket: "cloudme-3e936.firebasestorage.app",
  messagingSenderId: "905409647808",
  appId: "1:905409647808:web:6ddb8a8a3ee162c8ad0925"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();
