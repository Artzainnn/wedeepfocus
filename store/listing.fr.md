# Fiche Chrome Web Store (français)

Copie chaque bloc dans le champ correspondant de la console développeur du Chrome Web Store (fiche en français). Les champs réservés à l'équipe de revue (justifications des autorisations, pratiques de confidentialité, instructions de test) se remplissent une seule fois, en anglais : voir `listing.en.md`. Leur traduction est donnée ici pour référence.

## Nom

```
WeDeepFocus
```

(Vient de `appName` dans `i18n/common.json`. Le store le lit dans le manifeste.)

## Description courte (132 caractères max)

```
Bloque les sites qui te distraient pendant tes heures de focus et affiche ton objectif à la place. Sans compte, sans pistage.
```

125 caractères. C'est `appDescription` dans `i18n/common.json`, garde les deux identiques (`build-locales` refuse plus de 132 caractères).

## Description détaillée

```
WeDeepFocus t'éloigne des sites qui te volent ton temps quand tu veux te concentrer, et te montre ce vers quoi tu avances.

QUAND TU OUVRES UN SITE BLOQUÉ, TU VOIS TON OBJECTIF
À la place du fil d'actualité : ton objectif, le temps restant et une petite phrase pour tenir. Un clic et tu retournes au travail.

DES GROUPES DE SITES, À TA FAÇON
• Des groupes tout prêts : réseaux sociaux, vidéo et streaming, mails et messageries, actualités, shopping (par exemple Instagram, TikTok, YouTube ou Reddit)
• Active ou désactive un groupe, ajoute ou retire ses sites
• Crée tes propres groupes avec un nom et une icône, comme « Messagerie pro » ou « Jeux »
• Ajoute des sites à part dans « Tes sites », ou bloque le site ouvert en un clic depuis la barre d'outils

C'EST TOI QUI DÉCIDES QUAND
• Lance une session depuis l'icône de l'extension : 15 minutes, 30 minutes, 1 heure ou la durée de ton choix, jusqu'à 8 heures
• Ou ajoute des créneaux hebdomadaires si tu veux, par exemple du lundi au vendredi, de 09:00 à 12:00 (les créneaux de nuit marchent aussi)
• Compte à rebours en direct dans la fenêtre de l'extension et temps restant sur l'icône

STRICT, ET C'EST VOULU
• Arrêter une session avant la fin est un rituel : une question honnête, puis une phrase à taper à la main (copier-coller désactivé, fautes de frappe refusées). Ensuite, toute la session s'arrête. Cette pause suffit souvent à te faire changer d'avis. Tu peux toujours désactiver l'extension dans chrome://extensions.
• La phrase par défaut : « Je choisis de renoncer à mes objectifs. J'échange mes aspirations et mes engagements contre quelques minutes de distraction. » Tu peux écrire la tienne dans les réglages. Elle ne peut pas être modifiée pendant un blocage
• Pendant un blocage, les réglages ne peuvent que se durcir : tu peux ajouter des sites, des groupes ou des créneaux, pas en retirer

PRIVÉ PAR DÉFAUT
• Pas de compte, pas de statistiques, pas de pub, pas de serveur
• Tes réglages restent dans ton navigateur (et dans ta propre synchronisation Chrome si tu l'utilises)
• L'accès aux sites est facultatif et demandé uniquement pour ceux que tu choisis. Il permet d'afficher ton objectif au lieu de la page d'erreur de Chrome. Sans lui, ces sites restent bloqués
• Tu peux tout recommencer depuis les réglages : un bouton remet tout par défaut

Gratuit. Si l'extension t'aide, un lien facultatif « Offrir un café au dev » t'attend dans la fenêtre de l'extension et dans les réglages.

Disponible en français et en anglais.

Aucun lien avec les sites mentionnés. Les marques citées appartiennent à leurs propriétaires.
```

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

1. Installation : la page d'accueil s'ouvre. Garde « Réseaux sociaux » sélectionné et clique sur Continuer. Chrome demande l'accès à ces sites : clique sur Autoriser (en cas de refus, les sites restent bloqués, avec la page d'erreur de Chrome au lieu de la page avec l'objectif). « Quand je lance une session » est déjà sélectionné : clique sur Continuer. Écris un objectif, puis clique sur Terminer.
2. Clique sur « Lancer une session de 10 min » sur le dernier écran (ou clique sur l'icône de l'extension, épinglée depuis le menu en forme de puzzle si besoin, puis sur « 15 min » sous « Bloquer pendant »).
3. Ouvre https://www.facebook.com : tu arrives sur la page de l'extension, avec ton objectif et un compte à rebours.
4. « J'en ai vraiment besoin » (ou « Arrêter la session » dans la fenêtre de l'extension) lance le rituel : une question (« Ça vaut vraiment le coup d'interrompre ton focus ? »), puis une phrase tapée à la main. Ensuite, toute la session s'arrête. La phrase se modifie dans les réglages, section « Arrêter une session avant la fin ».

Aucun compte ni identifiant n'est nécessaire.

## Visuels

| Visuel | Fichier | Taille |
| --- | --- | --- |
| Icône du store | `extension/assets/icon-128.png` | 128x128 (motif 96x96 avec marge transparente) |
| Petite vignette promo | `store/promo-small-440x280.png` | 440x280 |
| Bannière promo | `store/marquee-1400x560.png` | 1400x560 |
| Captures d'écran | `store/screenshots/fr-*.png` | 1280x800 |

Les vignettes promo ne contiennent aucun texte traduit (seulement le nom de la marque et une maquette de la page de blocage où le texte est remplacé par des barres), car le store affiche les mêmes vignettes dans toutes les langues. Ce sont les mêmes fichiers pour les deux fiches.

Ordre et légendes suggérés pour les captures :

1. `fr-1-blocked.png` : Ton objectif à la place du fil d'actualité
2. `fr-2-popup.png` : Lance une session de focus en un clic
3. `fr-3-options.png` : Regroupe les sites qui te distraient, à ta façon
4. `fr-4-onboarding.png` : Prêt en moins d'une minute
5. `fr-5-phrase.png` : Choisis ta propre phrase de déblocage

Pour régénérer les visuels : `npm run icons` et `npm run screenshots`.
