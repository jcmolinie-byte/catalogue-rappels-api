require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const webpush = require('web-push');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ── MONGODB ──────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connecté'))
  .catch(err => console.error('Erreur MongoDB:', err));

// ── WEB PUSH ─────────────────────────────────────────────────────────────────
webpush.setVapidDetails(
  'mailto:' + process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ── MODÈLE RAPPEL ────────────────────────────────────────────────────────────
const rappelSchema = new mongoose.Schema({
  articleRef:      { type: String, required: true },
  articleLabel:    { type: String, default: '' },
  subscription:    { type: Object, required: true },
  intervalMinutes: { type: Number, default: 45 },
  derniereNotif:   { type: Date, default: null },
  createdAt:       { type: Date, default: Date.now },
  confirme:        { type: Boolean, default: false }
});
const Rappel = mongoose.model('Rappel', rappelSchema);

// ── ROUTES ───────────────────────────────────────────────────────────────────

app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// Créer un rappel
app.post('/rappels', async (req, res) => {
  try {
    const { articleRef, articleLabel, subscription, intervalMinutes } = req.body;
    const rappel = new Rappel({
      articleRef,
      articleLabel,
      subscription,
      intervalMinutes: intervalMinutes || 45
    });
    await rappel.save();
    res.json({ success: true, id: rappel._id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Route debug — liste les rappels en cours
app.get('/rappels', async (req, res) => {
  try {
    const rappels = await Rappel.find({ confirme: false }, { subscription: 0 });
    res.json(rappels);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Confirmer un rappel
app.post('/rappels/:id/confirmer', async (req, res) => {
  try {
    await Rappel.findByIdAndUpdate(req.params.id, { confirme: true });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ENVOI NOTIFICATIONS ───────────────────────────────────────────────────────
async function envoyerRappels() {
  const rappels = await Rappel.find({ confirme: false });
  const maintenant = new Date();

  for (const rappel of rappels) {
    const intervalle = (rappel.intervalMinutes || 45) * 60 * 1000;
    const derniere = rappel.derniereNotif ? new Date(rappel.derniereNotif) : null;
    const doitEnvoyer = !derniere || (maintenant - derniere) >= intervalle;

    if (!doitEnvoyer) continue;

    try {
      await webpush.sendNotification(
        rappel.subscription,
        JSON.stringify({
          title: '⚠️ Ne pas oublier la sortie SAP',
          body: `Article ${rappel.articleRef}${rappel.articleLabel && rappel.articleLabel !== '—' ? ' — ' + rappel.articleLabel : ''} · Confirme quand c'est fait.`,
          icon: '/icon-192.png'
        })
      );
      await Rappel.findByIdAndUpdate(rappel._id, { derniereNotif: maintenant });
      console.log(`Rappel envoyé : ${rappel.articleRef}`);
    } catch (e) {
      if (e.statusCode === 410) {
        await Rappel.findByIdAndDelete(rappel._id);
        console.log(`Rappel ${rappel._id} supprimé (abonnement expiré)`);
      } else {
        console.error(`Erreur envoi rappel ${rappel._id}:`, e.message);
      }
    }
  }
}

// Vérification toutes les minutes
setInterval(envoyerRappels, 60 * 1000);
// Premier envoi immédiat au démarrage
envoyerRappels();

// ── KEEP ALIVE (évite l'endormissement Render gratuit) ───────────────────────
setInterval(() => {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (url) {
    fetch(url + '/vapid-public-key').catch(() => {});
    console.log('Keep-alive ping');
  }
}, 10 * 60 * 1000);

// ── DÉMARRAGE ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur démarré sur port ${PORT}`));
