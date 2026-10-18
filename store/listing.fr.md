# Fiche Chrome Web Store (français)

Pas utilisée : le Store n'a pas de fiche française (décision du 18/10/2026). Ce fichier reste comme traduction de référence.

Copie chaque bloc dans le champ correspondant de la console développeur du Chrome Web Store (fiche en français). Les champs réservés à l'équipe de revue (justifications des autorisations, pratiques de confidentialité, instructions de test) se remplissent une seule fois, en anglais : voir `listing.en.md`. Leur traduction est donnée ici pour référence.

## Nom

```
WeDeepFocus
```

(Vient de `appName` dans `i18n/common.json`. Le store le lit dans le manifeste.)

## Description courte (132 caractères max)

```
Bloque les sites qui te distraient en deux clics et rappelle-toi pourquoi tu fais ça. Gratuit, open source, sans compte.
```

120 caractères. C'est `appDescription` dans `i18n/common.json`, garde les deux identiques (`build-locales` refuse plus de 132 caractères).

## Description détaillée

```
Instagram peut attendre. WeDeepFocus bloque les sites qui te détournent quand tu veux te concentrer, et te rappelle pourquoi tu fais ça.

COMMENT ÇA MARCHE
1. Choisis ce qui te distrait : réseaux sociaux, vidéo, actus, shopping, ou tes propres sites.
2. Clique sur l'icône et choisis 15 min, 30 min ou 1 h. Ou programme des créneaux, par exemple en semaine de 09:00 à 12:00.
3. Ouvre un site bloqué : tu vois le temps restant et ton pourquoi, une phrase que tu as choisie ou écrite. Un clic et tu retournes au travail.

BESOIN DE PLUS DE TEMPS ?
Ajoute 15 minutes depuis l'icône. Le temps restant s'affiche directement dessus.

ARRÊTER AVANT LA FIN, ÇA SE MÉRITE
Une question honnête, puis une phrase tapée à la main. Copier-coller interdit, fautes de frappe refusées. Cette pause suffit souvent à te faire changer d'avis. Pendant une session, les réglages ne peuvent que se durcir.

TES SITES, À TA FAÇON
• Des groupes tout prêts (Instagram, TikTok, YouTube, Reddit et d'autres), avec des sites à garder ou retirer
• Tes propres groupes avec un nom et une icône, comme « Messagerie pro »
• Bloque le site ouvert en un clic depuis la barre d'outils

GRATUIT, OPEN SOURCE, PRIVÉ
• Pas de compte, pas de pub, pas de statistiques : tes réglages restent dans ton navigateur
• Open source sous licence MIT : github.com/Artzainnn/wedeepfocus
• L'accès aux sites est facultatif et demandé uniquement pour ceux que tu choisis. Sans lui, ces sites restent bloqués, avec la page d'erreur de Chrome

Gratuit. Si l'extension t'aide, un lien facultatif « Offrir un café au dev » t'attend. Une idée, un bug ? wedeepfocus.com/fr/feedback

Marche dans Chrome et dans les navigateurs Chromium comme Arc, Brave et Edge. En français et en anglais.

Aucun lien avec les sites mentionnés. Les marques citées appartiennent à leurs propriétaires.
```

## Vidéo promo

```
https://youtu.be/yZ5A0IPuPWM
```

Le champ « Vidéo YouTube » de la fiche (film de lancement de 37 s).

## Catégorie

Productivité, sous-catégorie « Workflow et planification » (ou « Outils » si elle n'est pas proposée).

## Objectif unique

```
WeDeepFocus bloque les sites choisis par l'utilisateur, aux heures de focus qu'il a définies (sessions lancées à la main ou créneaux hebdomadaires), et affiche son propre objectif à la place de ces sites.
```

## Justification des autorisations (traduction de référence)

Manifeste : `"permissions": ["declarativeNetRequest", "storage", "alarms", "activeTab"]` et `"optional_host_permissions": ["*://*/*"]`, sans `host_permissions`. À l'installation, Chrome affiche un seul avertissement, « Block content on any page » en anglais (bloquer du contenu sur n'importe quelle page), qui vient de `declarativeNetRequest` : c'est honnête pour un bloqueur, et l'extension ne bloque jamais que les sites choisis par l'utilisateur.

**declarativeNetRequest** : bloque ou redirige uniquement les sites que l'utilisateur a choisi de bloquer, et seulement pendant les heures de focus qu'il a définies (session lancée depuis la fenêtre de l'extension ou créneaux hebdomadaires). Les règles sont construites sur l'appareil à partir de ses groupes et de ses sites, et ne concernent que le chargement principal des pages de ces domaines. Les sites auxquels il a donné accès sont redirigés vers la page de l'extension qui affiche son objectif ; les autres affichent la page d'erreur standard de Chrome. Aucune autre requête n'est lue, enregistrée ou modifiée, et le contenu des pages n'est jamais lu.

**Autorisations d'accès aux sites (optional_host_permissions : \*://\*/\*)** : facultatives et jamais demandées à l'installation. Le manifeste déclare *://*/* comme facultatif uniquement parce que l'utilisateur peut ajouter n'importe quel site. Quand il choisit des sites à bloquer, l'extension demande à Chrome l'accès à ces sites seulement, à ce moment-là (par exemple *://linkedin.com/* et *://*.linkedin.com/*). Cet accès sert à deux choses : afficher la page avec son objectif au lieu de la page d'erreur de Chrome quand un de ces sites est ouvert pendant un blocage (une redirection declarativeNetRequest exige l'accès au site), et basculer vers cette page les onglets déjà ouverts sur ces sites quand un blocage commence ou quand un de ces onglets change d'adresse. Aucun script injecté, aucun contenu de page lu. S'il refuse, le site reste bloqué, avec la page d'erreur de Chrome.

**storage** : enregistre les réglages (groupes de sites avec leur nom et leur icône, sites ajoutés à part, créneaux, objectif, phrase de déblocage personnalisée, préférences) dans chrome.storage.sync, et l'état de l'extension (fin de la session en cours, fin d'une session arrêtée avant la fin, liste des sites verrouillés jusqu'à la fin du blocage en cours, compteurs du jour affichés à l'utilisateur) dans chrome.storage.local et chrome.storage.session. Les réglages ne sont jamais envoyés à un serveur.

**alarms** : démarre et termine à l'heure les sessions et les blocages programmés, reprend les créneaux après une session arrêtée avant la fin et tient à jour le temps restant affiché sur l'icône pendant un blocage.

**activeTab** : quand l'utilisateur ouvre la fenêtre de l'extension, lit l'adresse de l'onglet actif pour afficher le nom du site et proposer « Bloquer ce site ». Aucun accès au contenu de la page ni aux autres onglets.

**Code distant** : non. Tout le JavaScript est inclus dans le paquet.

## Pratiques de confidentialité (traduction de référence)

Aucune donnée utilisateur n'est collectée : laisse toutes les cases décochées (informations d'identification, santé, finances, authentification, communications, localisation, historique web, activité, contenu des sites). L'extension n'effectue aucune requête réseau. Le lien facultatif « Offrir un café au dev » ouvre seulement une page Stripe dans un nouvel onglet. Tout ce qu'elle garde est stocké avec `chrome.storage` dans le navigateur de l'utilisateur : les réglages dans `chrome.storage.sync`, qui reste sur l'appareil, ou que Google synchronise dans le propre compte Google de l'utilisateur quand la synchronisation Chrome est activée (le développeur n'y a pas accès), et l'état courant dans `chrome.storage.local` et `chrome.storage.session`, sur cet appareil uniquement. L'adresse de l'onglet actif (lue via activeTab à l'ouverture de la fenêtre de l'extension) et l'adresse d'une page bloquée (gardée dans l'adresse de la page de blocage pour son bouton « Continuer ») ne servent que sur l'appareil, ne sont stockées nulle part ailleurs et ne sont jamais transmises. « Tout réinitialiser », dans les réglages, efface les réglages synchronisés et l'état local.

Coche les trois certifications (pas de vente ni de transfert de données, pas d'usage sans rapport avec l'objectif unique, pas d'usage pour évaluer la solvabilité).

URL de la politique de confidentialité :

```
https://wedeepfocus.com/fr/privacy/
```

Publie `PRIVACY.md` à une adresse publique (par exemple GitHub Pages ou ton site), ajoute l'adresse de contact dedans, puis colle son URL ici.

## Instructions de test (traduction de référence)

1. Installation : la page d'accueil s'ouvre. Garde « Réseaux sociaux » sélectionné et clique sur Continuer. Chrome demande l'accès à ces sites : clique sur Autoriser (en cas de refus, les sites restent bloqués, avec la page d'erreur de Chrome au lieu de la page de l'extension). « Quand je lance une session » est déjà sélectionné : clique sur Continuer. Une phrase est déjà choisie sous « Pourquoi tu fais ça ? » : clique sur Terminer.
2. L'écran suivant montre comment épingler l'icône : épingle-la depuis le menu en forme de puzzle (l'écran avance tout seul), ou clique sur Passer. Puis clique sur « Lancer une session de 15 min » (ou sur l'icône de l'extension, puis « 15 min »).
3. Ouvre https://www.facebook.com : tu arrives sur la page de l'extension, avec le temps restant et ta phrase.
4. « J'en ai vraiment besoin » (ou « Arrêter la session » dans la fenêtre de l'extension) lance le rituel : une question (« Ça vaut vraiment le coup d'interrompre ton focus ? »), puis une phrase tapée à la main. Ensuite, toute la session s'arrête. La phrase se modifie dans les réglages, section « Arrêter une session avant la fin ».

Aucun compte ni identifiant n'est nécessaire.

## Visuels

| Visuel | Fichier | Taille |
| --- | --- | --- |
| Icône du store | `extension/assets/icon-128.png` | 128x128 (motif 96x96 avec marge transparente) |
| Petite vignette promo | `store/upload/promo-small-440x280.png` | 440x280 |
| Bannière promo | `store/upload/marquee-1400x560.png` | 1400x560 |
| Captures d'écran | `store/upload/fr/fr-*.png` | 1280x800 |

Tout vient de `node scripts/store-visuals.mjs` (vraies captures de l'extension avec un titre). Les vignettes promo sont en anglais : le store affiche les mêmes dans toutes les langues, ce sont donc les mêmes fichiers pour les deux fiches.

Ordre et légendes suggérés pour les captures :

1. `fr-1-blocked.png` : Instagram peut attendre (la page bloquée : temps restant et ton pourquoi)
2. `fr-2-popup.png` : Concentre-toi en deux clics (lancer une session, ajouter 15 minutes)
3. `fr-3-groups.png` : Choisis ce qui te distrait
4. `fr-4-why.png` : Rappelle-toi pourquoi
5. `fr-5-friction.png` : Arrêter avant la fin, ça se mérite (copier-coller interdit)

Pour régénérer les visuels : `npm run icons` et `npm run screenshots`.
