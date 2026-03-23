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
  articleRef:   { type: String, required: true },
  articleLabel: { type: String, default: '' },
  subscription: { type: Object, required: true },
  createdAt:    { type: Date, default: Date.now },
  confirme:     { type: Boolean, default: false }
});
const Rappel = mongoose.model('Rappel', rappelSchema);

// ── ROUTES ───────────────────────────────────────────────────────────────────

// Clé publique VAPID (nécessaire pour s'abonner côté client)
app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// Créer un rappel
app.post('/rappels', async (req, res) => {
  try {
    const { articleRef, articleLabel, subscription } = req.body;
    const rappel = new Rappel({ articleRef, articleLabel, subscription });
    await rappel.save();
    res.json({ success: true, id: rappel._id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Confirmer un rappel (sortie SAP faite)
app.post('/rappels/:id/confirmer', async (req, res) => {
  try {
    await Rappel.findByIdAndUpdate(req.params.id, { confirme: true });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ENVOI NOTIFICATIONS TOUTES LES HEURES ────────────────────────────────────
async function envoyerRappels() {
  const rappels = await Rappel.find({ confirme: false });
  console.log(`Envoi rappels: ${rappels.length} en attente`);

  for (const rappel of rappels) {
    try {
      await webpush.sendNotification(
        rappel.subscription,
        JSON.stringify({
          title: '⚠️ Sortie SAP à faire !',
          body: `Article ${rappel.articleRef} — ${rappel.articleLabel} — N'oublie pas la sortie de stock SAP !`,
          icon: '/icon-192.png'
        })
      );
    } catch (e) {
      // Abonnement expiré → supprimer le rappel
      if (e.statusCode === 410) {
        await Rappel.findByIdAndDelete(rappel._id);
        console.log(`Rappel ${rappel._id} supprimé (abonnement expiré)`);
      }
    }
  }
}

// Lancer toutes les heures
setInterval(envoyerRappels, 60 * 60 * 1000);
// Premier envoi 5 minutes après démarrage
setTimeout(envoyerRappels, 5 * 60 * 1000);

// ── DÉMARRAGE ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur démarré sur port ${PORT}`));
