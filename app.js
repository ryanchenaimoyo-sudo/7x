// App.js - Full core (local-first, optional Firebase, image upload, auth, realtime feed)
// Dependencies (add these in Snack or package.json):
//  firebase
//  expo-auth-session
//  expo-image-picker
//  @react-native-async-storage/async-storage

import React, { useEffect, useState, useRef } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Modal,
  StyleSheet,
  Image,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";

/* =========================
   CONFIG - Replace to enable cloud mode
   =========================
   - If you don't paste Firebase config, app runs in LOCAL mode (no cloud).
   - To enable Google sign-in for standalone builds, add GOOGLE_WEB_CLIENT_ID later.
*/
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "SENDER_ID",
  appId: "APP_ID",
};

const GOOGLE_WEB_CLIENT_ID = ""; // optional: "xxxxx-abc.apps.googleusercontent.com"

/* =========================
   CONDITIONAL FIREBASE INIT
   ========================= */
let firebaseReady = false;
let firebaseLibs = null;
let auth = null;
let db = null;
let storage = null;

const tryInitFirebase = () => {
  try {
    // Only attempt if firebaseConfig appears replaced
    if (!firebaseConfig || !firebaseConfig.apiKey || firebaseConfig.apiKey === "YOUR_API_KEY") {
      firebaseReady = false;
      return;
    }
    // modular imports - require ensures Snack bundles only when dependency present
    const { initializeApp } = require("firebase/app");
    const {
      getAuth,
      onAuthStateChanged,
      createUserWithEmailAndPassword,
      signInWithEmailAndPassword,
      signOut,
      GoogleAuthProvider,
      signInWithCredential,
    } = require("firebase/auth");
    const {
      getFirestore,
      collection,
      addDoc,
      doc,
      updateDoc,
      getDoc,
      onSnapshot,
      query,
      orderBy,
      serverTimestamp,
      increment,
      getDocs,
    } = require("firebase/firestore");
    const { getStorage, ref, uploadBytesResumable, getDownloadURL } = require("firebase/storage");

    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);

    firebaseLibs = {
      // auth
      onAuthStateChanged,
      createUserWithEmailAndPassword,
      signInWithEmailAndPassword,
      signOut,
      GoogleAuthProvider,
      signInWithCredential,
      // firestore
      collection,
      addDoc,
      doc,
      updateDoc,
      getDoc,
      onSnapshot,
      query,
      orderBy,
      serverTimestamp,
      increment,
      getDocs,
      // storage
      ref,
      uploadBytesResumable,
      getDownloadURL,
    };

    firebaseReady = true;
  } catch (e) {
    console.warn("Firebase not initialized (running local-only). Ensure 'firebase' dependency is installed if you want cloud mode.", e);
    firebaseReady = false;
    firebaseLibs = null;
    auth = null;
    db = null;
    storage = null;
  }
};
tryInitFirebase();

/* =========================
   Storage keys and Local Controller
   ========================= */
const StorageKeys = {
  POSTS: "@tstar_posts_v2",
  SESSION: "@tstar_session_v2",
  BLOCKS: "@tstar_blocks_v2",
  REPORTS: "@tstar_reports_v2",
};

const LocalController = {
  save: async (key, value) => {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn("[Local.save] failed", e);
    }
  },

  load: async (key, fallback = null) => {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn("[Local.load] failed", e);
      return fallback;
    }
  },

  seedIfNeeded: async () => {
    const posts = await LocalController.load(StorageKeys.POSTS, null);
    if (!posts) {
      const starter = [
        {
          id: "p_start",
          author: "System",
          text: "Welcome to T-Star Traders — local demo. Add Firebase config to enable cloud mode.",
          imageUrl: null,
          likes: 0,
          comments: [],
          createdAt: Date.now(),
          isPremium: false,
        },
      ];
      await LocalController.save(StorageKeys.POSTS, starter);
    }
  },

  clearAll: async () => {
    try {
      await AsyncStorage.multiRemove(Object.values(StorageKeys));
    } catch (e) {
      console.warn("clearAll failed", e);
    }
  },
};

/* =========================
   Utility helpers
   ========================= */
const profanityList = ["badword", "spamword"];
const containsProfanity = (text) => (text || "").toLowerCase().split(/\s+/).some((w) => profanityList.includes(w));
async function uriToBlob(uri) {
  const response = await fetch(uri);
  const blob = await response.blob();
  return blob;
}

/* =========================
   App UI + Logic
   ========================= */
export default function App() {
  // mode decides behavior: 'cloud' if firebase initialized, else 'local'
  const cloudAvailable = firebaseReady && firebaseLibs;
  const [mode, setMode] = useState(cloudAvailable ? "cloud" : "local");
  const [loading, setLoading] = useState(true);

  // data state
  const [posts, setPosts] = useState([]);
  const [session, setSession] = useState(null);
  const [composerText, setComposerText] = useState("");
  const [composerImage, setComposerImage] = useState(null);
  const [commentsModal, setCommentsModal] = useState({ visible: false, post: null });
  const [signModalVisible, setSignModalVisible] = useState(false);
  const [emailForm, setEmailForm] = useState({ email: "", password: "", displayName: "" });
  const cloudUnsubRef = useRef(null);

  // init
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (mode === "cloud" && firebaseReady && firebaseLibs && auth && db) {
        // cloud: attach auth listener and subscribe to posts
        try {
          firebaseLibs.onAuthStateChanged(auth, (user) => {
            if (user) {
              setSession({ uid: user.uid, displayName: user.displayName || user.email || "Trader", email: user.email || null });
            } else {
              setSession(null);
            }
          });
        } catch (e) {
          console.warn("auth listener failed", e);
        }

        try {
          const postsCol = firebaseLibs.collection(db, "posts");
          const q = firebaseLibs.query(postsCol, firebaseLibs.orderBy("createdAt", "desc"));
          cloudUnsubRef.current = firebaseLibs.onSnapshot(q, (snap) => {
            const arr = snap.docs.map((d) => {
              const data = d.data();
              return {
                id: d.id,
                text: data.text,
                author: data.author || data.authorName || "Unknown",
                authorUid: data.authorUid || null,
                imageUrl: data.imageUrl || null,
                likes: data.likes || 0,
                comments: data.comments || [],
                commentsCount: data.commentsCount || 0,
                createdAt: data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : data.createdAt || Date.now(),
                isPremium: data.isPremium || false,
              };
            });
            if (mounted) setPosts(arr);
          });
        } catch (e) {
          console.warn("subscribe posts failed", e);
        }

        // load local moderation lists
        const b = (await LocalController.load(StorageKeys.BLOCKS, {})) || {};
        const r = (await LocalController.load(StorageKeys.REPORTS, [])) || [];
        // (we keep them stored locally only)
        if (mounted) setLoading(false);
        return;
      }

      // local mode
      try {
        await LocalController.seedIfNeeded();
        const localPosts = (await LocalController.load(StorageKeys.POSTS, [])) || [];
        const localSession = (await LocalController.load(StorageKeys.SESSION, null)) || null;
        setPosts(localPosts);
        setSession(localSession);
        if (mounted) setLoading(false);
      } catch (e) {
        console.warn("local init failed", e);
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
      if (cloudUnsubRef.current) {
        try { cloudUnsubRef.current(); } catch {}
        cloudUnsubRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  /* -------------------------
     Auth helpers
     ------------------------- */
  const localSignIn = async (displayName) => {
    const u = { uid: "u" + Date.now(), displayName: displayName || `Trader${Math.floor(Math.random() * 1000)}`, createdAt: Date.now() };
    await LocalController.save(StorageKeys.SESSION, u);
    setSession(u);
  };
  const localSignOut = async () => {
    await LocalController.save(StorageKeys.SESSION, null);
    setSession(null);
  };

  const cloudSignUpEmail = async (email, password, displayName) => {
    try {
      const cred = await firebaseLibs.createUserWithEmailAndPassword(auth, email, password);
      // optional: create users doc
      try {
        await firebaseLibs.addDoc(firebaseLibs.collection(db, "users"), {
          uid: cred.user.uid,
          email,
          displayName: displayName || email,
          createdAt: firebaseLibs.serverTimestamp(),
        });
      } catch {}
      return cred.user;
    } catch (e) {
      throw e;
    }
  };
  const cloudSignInEmail = async (email, password) => {
    try {
      await firebaseLibs.signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      throw e;
    }
  };
  const cloudSignOut = async () => {
    try {
      await firebaseLibs.signOut(auth);
    } catch (e) {
      console.warn("cloudSignOut failed", e);
    }
  };

  /* -------------------------
     Image upload (cloud)
     ------------------------- */
  const uploadImageToStorage = async (uri) => {
    if (!storage || !firebaseLibs) throw new Error("Storage not initialized");
    try {
      const blob = await uriToBlob(uri);
      const filename = `images/${Date.now()}_${Math.random().toString(36).slice(2, 9)}.jpg`;
      const fileRef = firebaseLibs.ref(storage, filename);
      const snap = await new Promise((resolve, reject) => {
        const task = firebaseLibs.uploadBytesResumable(fileRef, blob);
        task.on(
          "state_changed",
          () => {},
          (err) => reject(err),
          () => resolve(task.snapshot)
        );
      });
      const url = await firebaseLibs.getDownloadURL(snap.ref);
      return url;
    } catch (e) {
      console.warn("upload failed", e);
      throw e;
    }
  };

  /* -------------------------
     Create post (cloud or local)
     ------------------------- */
  const createPost = async (text, imageUri) => {
    if (!text || text.trim() === "") {
      Alert.alert("Empty post", "Write something before posting.");
      return;
    }
    if (containsProfanity(text)) {
      Alert.alert("Blocked", "Your post contains disallowed words.");
      return;
    }

    if (mode === "cloud" && firebaseLibs) {
      try {
        let imageUrl = null;
        if (imageUri) imageUrl = await uploadImageToStorage(imageUri);
        await firebaseLibs.addDoc(firebaseLibs.collection(db, "posts"), {
          text,
          author: session?.displayName || "Guest",
          authorUid: session?.uid || null,
          imageUrl,
          likes: 0,
          commentsCount: 0,
          createdAt: firebaseLibs.serverTimestamp(),
          isPremium: false,
        });
        // onSnapshot will update UI
      } catch (e) {
        console.warn("cloud createPost failed", e);
        Alert.alert("Cloud error", "Saved locally instead.");
        await savePostLocally(text, imageUri);
      }
    } else {
      await savePostLocally(text, imageUri);
    }
    setComposerText("");
    setComposerImage(null);
  };

  const savePostLocally = async (text, imageUri) => {
    try {
      const current = (await LocalController.load(StorageKeys.POSTS, [])) || [];
      const newp = {
        id: "p" + Date.now(),
        author: session?.displayName || "Guest",
        text,
        imageUrl: imageUri || null,
        likes: 0,
        comments: [],
        createdAt: Date.now(),
        isPremium: false,
      };
      const next = [newp, ...current].slice(0, 500);
      await LocalController.save(StorageKeys.POSTS, next);
      setPosts(next);
    } catch (e) {
      console.warn("savePostLocally failed", e);
    }
  };

  /* -------------------------
     Add comment
     ------------------------- */
  const addComment = async (postId, text) => {
    if (!text || text.trim() === "") return;
    if (mode === "cloud" && firebaseLibs) {
      try {
        const commentsRef = firebaseLibs.collection(db, "posts", postId, "comments");
        await firebaseLibs.addDoc(commentsRef, {
          text,
          author: session?.displayName || "Guest",
          authorUid: session?.uid || null,
          createdAt: firebaseLibs.serverTimestamp(),
        });
        const postRef = firebaseLibs.doc(db, "posts", postId);
        // increment commentsCount safely using increment
        await firebaseLibs.updateDoc(postRef, { commentsCount: firebaseLibs.increment(1) });
      } catch (e) {
        console.warn("cloud addComment failed", e);
        await saveCommentLocally(postId, text);
      }
    } else {
      await saveCommentLocally(postId, text);
    }
  };

  const saveCommentLocally = async (postId, text) => {
    try {
      const current = (await LocalController.load(StorageKeys.POSTS, [])) || [];
      const next = current.map((p) =>
        p.id === postId ? { ...p, comments: [...(p.comments || []), { id: "c" + Date.now(), author: session?.displayName || "Guest", text, createdAt: Date.now() }] } : p
      );
      await LocalController.save(StorageKeys.POSTS, next);
      setPosts(next);
    } catch (e) {
      console.warn("saveCommentLocally failed", e);
    }
  };

  /* -------------------------
     Like post
     ------------------------- */
  const likePost = async (postId) => {
    if (mode === "cloud" && firebaseLibs) {
      try {
        const pRef = firebaseLibs.doc(db, "posts", postId);
        await firebaseLibs.updateDoc(pRef, { likes: firebaseLibs.increment(1) });
      } catch (e) {
        console.warn("cloud like failed", e);
        await likeLocally(postId);
      }
    } else {
      await likeLocally(postId);
    }
  };

  const likeLocally = async (postId) => {
    const current = (await LocalController.load(StorageKeys.POSTS, [])) || [];
    const next = current.map((p) => (p.id === postId ? { ...p, likes: (p.likes || 0) + 1 } : p));
    await LocalController.save(StorageKeys.POSTS, next);
    setPosts(next);
  };

  /* -------------------------
     Report & block (local)
     ------------------------- */
  const reportPost = async (postId, reason = "Reported via app") => {
    try {
      const r = (await LocalController.load(StorageKeys.REPORTS, [])) || [];
      const newr = { id: "r" + Date.now(), postId, reason, reporter: session?.displayName || "Guest", createdAt: Date.now() };
      const next = [newr, ...r].slice(0, 1000);
      await LocalController.save(StorageKeys.REPORTS, next);
      Alert.alert("Reported", "Report saved locally.");
    } catch (e) {
      console.warn("report failed", e);
    }
  };

  const blockAuthor = async (authorIdentifier) => {
    try {
      const blocks = (await LocalController.load(StorageKeys.BLOCKS, {})) || {};
      const me = session?.uid || "guest";
      const myBlocks = blocks[me] || [];
      const next = { ...blocks, [me]: Array.from(new Set([...myBlocks, authorIdentifier])) };
      await LocalController.save(StorageKeys.BLOCKS, next);
      Alert.alert("Blocked", `${authorIdentifier} blocked locally.`);
    } catch (e) {
      console.warn("block failed", e);
    }
  };

  /* -------------------------
     Image picker (local) - picks image and sets composerImage
     ------------------------- */
  const pickImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert("Permission needed", "Please allow access to photos to attach images.");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.6,
        allowsEditing: true,
      });
      const uri = res?.assets?.[0]?.uri ?? res?.uri ?? null;
      if (!res.cancelled && uri) {
        setComposerImage(uri);
      }
    } catch (e) {
      console.warn("pickImage failed", e);
      Alert.alert("Error", "Could not pick image.");
    }
  };

  /* -------------------------
     UI actions: sign modal handlers
     ------------------------- */
  const handleCreateAccount = async () => {
    const { email, password, displayName } = emailForm;
    if (!email || !password) {
      Alert.alert("Missing", "Email and password required.");
      return;
    }
    if (mode === "cloud" && firebaseLibs) {
      try {
        await cloudSignUpEmail(email, password, displayName);
        Alert.alert("Account created", "Sign in using the form.");
        setSignModalVisible(false);
      } catch (e) {
        console.warn("signup error", e);
        Alert.alert("Signup failed", String(e.message || e));
      }
    } else {
      // local quick sign-in with displayName or email prefix
      await localSignIn(displayName || email.split("@")[0]);
      setSignModalVisible(false);
    }
  };

  const handleSignIn = async () => {
    const { email, password } = emailForm;
    if (!email || !password) {
      Alert.alert("Missing", "Email and password required.");
      return;
    }
    if (mode === "cloud" && firebaseLibs) {
      try {
        await cloudSignInEmail(email, password);
        setSignModalVisible(false);
      } catch (e) {
        console.warn("signin failed", e);
        Alert.alert("Sign in failed", String(e.message || e));
      }
    } else {
      await localSignIn(email.split("@")[0] || `Trader${Math.floor(Math.random() * 1000)}`);
      setSignModalVisible(false);
    }
  };

  /* -------------------------
     Render
     ------------------------- */
  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  // visible posts filter (client-side blocked authors)
  const myId = session?.uid || "guest";
  const blocks = useRef(null);
  // load blocks once (simple)
  useEffect(() => {
    (async () => {
      const b = (await LocalController.load(StorageKeys.BLOCKS, {})) || {};
      blocks.current = b;
    })();
  }, []);

  const visiblePosts = posts.filter((p) => {
    const blocked = (blocks.current && blocks.current[myId]) || [];
    return !blocked.includes(p.author) && !blocked.includes(p.authorUid);
  });

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>T-Star Traders {mode === "cloud" ? "(Cloud)" : "(Local)"}</Text>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {session ? (
            <>
              <Text style={styles.headerUser}>@{session.displayName}</Text>
              <TouchableOpacity
                onPress={async () => {
                  if (mode === "cloud") await cloudSignOut();
                  else await localSignOut();
                }}
                style={{ marginLeft: 8 }}
              >
                <Text style={{ color: "#ff6b6b" }}>Sign out</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity onPress={() => setSignModalVisible(true)}>
              <Text style={{ color: "#00aaff" }}>Sign in</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Composer */}
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
        <View style={styles.composer}>
          <TextInput
            value={composerText}
            onChangeText={setComposerText}
            placeholder="Share a trade idea..."
            multiline
            style={[styles.input, { minHeight: 50 }]}
          />
          {composerImage ? <Image source={{ uri: composerImage }} style={styles.previewImage} /> : null}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flexDirection: "row" }}>
              <TouchableOpacity style={styles.iconBtn} onPress={pickImage}>
                <Text>📷</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.button, { paddingHorizontal: 16 }]}
              onPress={() => createPost(composerText.trim(), composerImage)}
            >
              <Text style={styles.buttonText}>Post</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Feed */}
        <FlatList
          data={visiblePosts}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => (
            <View style={styles.post}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={styles.postAuthor}>{item.author}</Text>
                <Text style={styles.postTime}>{new Date(item.createdAt).toLocaleString()}</Text>
              </View>
              <Text style={styles.postText}>{item.text}</Text>
              {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.postImage} /> : null}
              <View style={styles.postActions}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => likePost(item.id)}>
                  <Text>👍 {item.likes ?? 0}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => {
                    setCommentsModal({ visible: true, post: item });
                  }}
                >
                  <Text>💬 {Array.isArray(item.comments) ? item.comments.length : item.commentsCount ?? 0}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={() => reportPost(item.id)}>
                  <Text>🚩</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={() => blockAuthor(item.author || item.authorUid)}>
                  <Text>🔒</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          contentContainerStyle={{ paddingBottom: 120 }}
          ListEmptyComponent={<Text style={{ padding: 12 }}>No posts yet — be first!</Text>}
        />
      </ScrollView>

      {/* Comments Modal */}
      <CommentsModal
        visible={commentsModal.visible}
        post={commentsModal.post}
        onClose={() => setCommentsModal({ visible: false, post: null })}
        onAddComment={addComment}
      />

      {/* Sign Modal */}
      <Modal visible={signModalVisible} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 8 }}>Sign in / Create</Text>

            <TextInput placeholder="Email" style={styles.input} value={emailForm.email} onChangeText={(t) => setEmailForm((s) => ({ ...s, email: t }))} keyboardType="email-address" autoCapitalize="none" />
            <TextInput placeholder="Password" style={styles.input} value={emailForm.password} onChangeText={(t) => setEmailForm((s) => ({ ...s, password: t }))} secureTextEntry />
            <TextInput placeholder="Display name (optional)" style={styles.input} value={emailForm.displayName} onChangeText={(t) => setEmailForm((s) => ({ ...s, displayName: t }))} />

            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
              <TouchableOpacity style={[styles.button, { flex: 1, marginRight: 6 }]} onPress={handleCreateAccount}>
                <Text style={styles.buttonText}>Create</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, { flex: 1, marginLeft: 6 }]} onPress={handleSignIn}>
                <Text style={styles.buttonText}>Sign in</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={[styles.button, { marginTop: 12 }]} onPress={async () => {
              if (mode === "cloud") {
                Alert.alert("Google sign-in", "Use standalone build + Google OAuth client. For now use email sign-in.");
              } else {
                await localSignIn(`Trader${Math.floor(Math.random() * 1000)}`);
                setSignModalVisible(false);
              }
            }}>
              <Text style={styles.buttonText}>{mode === "cloud" ? "Sign in with Google (standalone)" : "Quick local sign-in"}</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setSignModalVisible(false)} style={[styles.button, { marginTop: 8, backgroundColor: "#ddd" }]}>
              <Text style={{ color: "#333", fontWeight: "700" }}>Close</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

/* CommentsModal component */
function CommentsModal({ visible, post, onClose, onAddComment }) {
  const [text, setText] = useState("");
  useEffect(() => setText(""), [visible, post]);
  if (!post) return null;
  return (
    <Modal visible={visible} animationType="slide">
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Comments</Text>
          <TouchableOpacity onPress={onClose}><Text style={{ color: "#007aff" }}>Close</Text></TouchableOpacity>
        </View>
        <FlatList
          data={post.comments || []}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <View style={styles.commentRow}>
              <Text style={styles.commentAuthor}>{item.author}</Text>
              <Text style={{ marginTop: 4 }}>{item.text}</Text>
            </View>
          )}
          ListEmptyComponent={<Text style={{ padding: 16 }}>No comments yet</Text>}
        />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.commentComposer}>
            <TextInput value={text} onChangeText={setText} placeholder="Write a comment..." style={[styles.input, { flex: 1 }]} />
            <TouchableOpacity style={styles.button} onPress={async () => { if (!text || text.trim() === "") return; await onAddComment(post.id, text.trim()); setText(""); }}>
              <Text style={styles.buttonText}>Send</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

/* =========================
   Styles
   ========================= */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f4f7fb" },
  header: {
    height: 64,
    backgroundColor: "#081029",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  title: { color: "#fff", fontSize: 16, fontWeight: "700" },
  headerUser: { color: "#ddd", marginLeft: 8 },

  composer: { backgroundColor: "#fff", padding: 10, margin: 8, borderRadius: 10 },
  input: { backgroundColor: "#f7f9fc", padding: 10, borderRadius: 8, marginBottom: 8 },
  previewImage: { width: 120, height: 80, borderRadius: 8, marginBottom: 8 },

  button: {
    backgroundColor: "#007aff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buttonText: { color: "#fff", fontWeight: "700" },

  iconBtn: { backgroundColor: "#eef6ff", padding: 8, borderRadius: 8, marginRight: 8 },

  post: { backgroundColor: "#fff", margin: 10, padding: 12, borderRadius: 10 },
  postAuthor: { fontWeight: "700" },
  postTime: { color: "#666", fontSize: 12 },
  postText: { marginTop: 8, fontSize: 15 },
  postImage: { width: "100%", height: 180, borderRadius: 8, marginTop: 8 },

  postActions: { flexDirection: "row", marginTop: 12, alignItems: "center" },
  actionBtn: { marginRight: 12 },

  modalHeader: { flexDirection: "row", justifyContent: "space-between", padding: 12, borderBottomWidth: 1, borderColor: "#eee" },
  modalTitle: { fontSize: 18, fontWeight: "700" },
  commentRow: { padding: 12, borderBottomWidth: 1, borderColor: "#f0f0f0" },
  commentAuthor: { fontWeight: "700" },
  commentComposer: { flexDirection: "row", padding: 12, alignItems: "center" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: "#fff", padding: 16, borderRadius: 12 },
});