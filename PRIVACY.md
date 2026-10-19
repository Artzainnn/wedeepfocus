# WeDeepFocus: Privacy Policy

<!-- Text between paid markers applies only while accountability payments are on (ACCOUNTABILITY_ENABLED in extension/shared/constants.js), text between free markers only while they are off. landing/build.mjs keeps the right one. -->

Version française plus bas.

Last updated: October 19, 2026

## Short version

WeDeepFocus collects nothing. There is no account, no analytics, no advertising and no tracking. Everything you set up stays in your browser, and in your own Google account if Chrome sync is on. <!--paid-->The only server is a small payment server, contacted only if you choose to pay to end a session early (see below).<!--/paid--><!--free-->The extension contacts no server.<!--/free-->

## What the extension stores, and where

| Data | Where | Why |
| --- | --- | --- |
| Your settings: your groups of sites (their names, icons and sites, and whether they are on), your own sites, weekly time slots if you add any, your goal, your custom unlock sentence (if you wrote one), display preferences | `chrome.storage.sync` | So your setup survives restarts and follows you across your own Chrome profiles |
| Current session end time, the end of a session you stopped early, the list of sites locked until the current block ends, today's counters (sites blocked, times you went back to work), your stats history (per day: focus time, blocked pages, sessions completed or ended early<!--paid-->, amounts paid<!--/paid-->), kept for one year | `chrome.storage.local` | To enforce blocks on this device, keep a running block from being loosened, and show you your own counters |
| The list of sites currently sent to the goal page | `chrome.storage.session` (memory only, cleared when Chrome closes) | To send tabs already open on those sites to the goal page |

When a blocked site is opened, its address is kept only in the address of the blocked page itself (after the `#` sign), so the page can offer to continue there once the block is over. It is not saved anywhere else.

None of this is ever sent to the developer or to any third party. The developer cannot see your settings.<!--paid--> Your way of ending a session early (with money or free only) and the amount you chose are part of your settings.<!--/paid-->

If Chrome sync is turned on in your browser, Google synchronizes `chrome.storage.sync` between your devices under your own Google account, like your other Chrome settings. This is handled by Chrome and covered by Google's privacy policy. If sync is off, settings stay on your device.

## Deleting your data

- **Start over**: at the bottom of the settings page, "Reset everything" deletes all your settings (on every computer where Chrome syncs them), clears what the extension keeps on this device (session, counters) and removes the site access you granted. Setup then starts again.
- **Change what you set up**: on the settings page you can edit your goal, turn groups off, remove sites and time slots, and put the standard unlock sentence back with "Reset to default". Outside a block, everything can be changed. During a block, strict mode only lets you make things stricter, on purpose; the block ends on its own at the time shown.
- **Remove everything**: uninstalling the extension (in `chrome://extensions`, click Remove) deletes all the data it stored in your browser.
- **Synced copy**: if Chrome sync is on, you can also delete the data Chrome syncs to your Google account from Chrome's sync settings.

## What the extension does not do

- It does not collect, log or transmit your browsing history.
- It does not read page content and does not inject any script into the pages you visit.
- It does not use cookies, analytics, crash reporting or advertising SDKs.
- It does not load any remote code. Every file it runs is included in the package reviewed by the Chrome Web Store.
- It makes no network requests of its own<!--paid-->, except to the payment server when you click Pay (see "Paying to end a session early")<!--/paid-->.

## Permissions, explained

- **declarativeNetRequest**: lets Chrome block the sites you chose, or send them to your goal page, only while a block is active. The matching happens inside Chrome, from your groups and sites: the extension doesn't see your browsing and nothing is recorded. At install, Chrome describes this permission as "Block content on any page"; in practice it only ever applies to the sites on your list.
- **Access to the sites you choose (optional)**: never requested at install. It's requested only for the sites you decide to block, when you add them, and it's used only to show your goal page instead of Chrome's error page when you open one of those sites during a block, and to send tabs already open on those sites to that page. If you don't allow it, those sites are still blocked, with Chrome's error page. You can review or revoke this access at any time in `chrome://extensions`.
- **storage**: saves your settings and the state described above.
- **alarms**: starts and ends blocks on time, resumes schedules after a session you stopped early and refreshes the countdown on the toolbar icon.
- **activeTab**: when you open the extension's popup, lets it read the address of the current tab so it can offer "Block this site". Only when you click the icon, only that tab, never the page content.

<!--paid-->
## Paying to end a session early (optional)

If you chose "Accountability with money", ending a session early can cost the amount you picked. Skipping for free (typing a sentence) is always possible, and "Free only" turns payments off. When you click Pay, the extension sends the payment server three things: the amount, the language of the page, and a random one-time code created for this payment. The server asks Stripe to open a payment page for that amount and later asks Stripe whether that payment went through, so the extension can end your session. The server stores nothing and receives no information about your browsing, your settings or your goals. The payment itself happens on Stripe and Stripe's privacy policy applies (https://stripe.com/privacy). The money goes to the developer. The Stripe page offers an optional message field: if you write something there, the developer can read it in Stripe.
<!--/paid-->

## The website

The website wedeepfocus.com (not the extension) uses DataFast to count visits: pages viewed, the referring site, country, device and browser, and clicks on a few buttons (Add to Chrome, the video, GitHub and the demo on the home page). It helps us understand how people find WeDeepFocus. The site also tells DataFast when a known crawler, such as a search engine or an AI assistant, requests a page; this concerns bots, not people. DataFast sets a cookie to recognise returning visitors and its privacy policy applies (https://datafa.st/privacy). The extension itself never loads DataFast and sends nothing.

## Feedback

The "Feedback" link in the extension's menu opens the feedback page of the website in a new tab. When you uninstall the extension, Chrome opens that same page, so you can say why if you want to. Only the language, where you came from ("menu" or "uninstall") and the extension version are in its address; the extension sends nothing else. If you send the form, your message and the email address you choose to give (optional) go to the developer by email through Web3Forms (https://web3forms.com/privacy). Nothing is sent if you don't press Send.

## Optional tip link

The "Buy a dev a coffee" link opens a Stripe payment page in a new tab. The extension sends nothing to Stripe. If you choose to pay, the payment happens on Stripe and Stripe's privacy policy applies (https://stripe.com/privacy). Like any Stripe merchant, the developer can see that payment in Stripe (for example the amount and the details you enter there). Nothing links it to how you use the extension.

## Children

The extension collects no personal information from anyone, including children.

## Changes

If this policy ever changes, the new version will be published at the same address with a new date. A change that introduced any data collection would require your explicit consent first.

## Contact

Questions: [contact]

---

# WeDeepFocus : politique de confidentialité

Dernière mise à jour : 19 octobre 2026

## En bref

WeDeepFocus ne collecte rien. Pas de compte, pas de statistiques, pas de publicité, pas de pistage. Tout ce que tu configures reste dans ton navigateur, et dans ton propre compte Google si la synchronisation de Chrome est activée. <!--paid-->Le seul serveur est un petit serveur de paiement, contacté seulement si tu choisis de payer pour arrêter une session avant la fin (voir plus bas).<!--/paid--><!--free-->L'extension ne contacte aucun serveur.<!--/free-->

## Ce que l'extension enregistre, et où

| Donnée | Où | Pourquoi |
| --- | --- | --- |
| Tes réglages : tes groupes de sites (leur nom, leur icône, leurs sites, actifs ou non), tes sites ajoutés à part, tes créneaux hebdomadaires si tu en ajoutes, ton objectif, ta phrase de déblocage personnalisée (si tu en as écrit une), préférences d'affichage | `chrome.storage.sync` | Pour que ta configuration survive aux redémarrages et te suive sur tes propres profils Chrome |
| Fin de la session en cours, fin d'une session que tu as arrêtée avant la fin, liste des sites verrouillés jusqu'à la fin du blocage en cours, compteurs du jour (sites bloqués, retours au travail), ton historique de stats (par jour : temps de focus, pages bloquées, sessions menées au bout ou arrêtées<!--paid-->, montants payés<!--/paid-->), gardé un an | `chrome.storage.local` | Pour appliquer les blocages sur cet appareil, empêcher d'assouplir un blocage en cours et t'afficher tes propres compteurs |
| La liste des sites actuellement renvoyés vers la page de ton objectif | `chrome.storage.session` (en mémoire uniquement, effacée à la fermeture de Chrome) | Pour basculer vers cette page les onglets déjà ouverts sur ces sites |

Quand tu ouvres un site bloqué, son adresse est gardée uniquement dans l'adresse de la page de blocage elle-même (après le signe `#`), pour que la page te propose d'y revenir une fois le blocage terminé. Elle n'est enregistrée nulle part ailleurs.

Rien de tout cela n'est jamais envoyé au développeur ni à un tiers. Le développeur ne peut pas voir tes réglages.<!--paid--> Ta façon d'arrêter une session avant la fin (avec argent ou gratuit seulement) et le montant choisi font partie de tes réglages.<!--/paid-->

Si la synchronisation Chrome est activée dans ton navigateur, Google synchronise `chrome.storage.sync` entre tes appareils avec ton propre compte Google, comme tes autres réglages Chrome. C'est géré par Chrome et couvert par la politique de confidentialité de Google. Si la synchronisation est désactivée, les réglages restent sur ton appareil.

## Supprimer tes données

- **Tout recommencer** : en bas des réglages, « Tout réinitialiser » efface tous tes réglages (sur tous les ordinateurs où Chrome les synchronise), vide ce que l'extension garde sur cet appareil (session, compteurs) et retire les accès aux sites que tu as accordés. La configuration recommence ensuite.
- **Modifier ce que tu as configuré** : dans les réglages, tu peux changer ton objectif, désactiver des groupes, retirer des sites et des créneaux, et remettre la phrase de déblocage standard avec « Remettre par défaut ». En dehors d'un blocage, tout se modifie. Pendant un blocage, le mode strict te laisse seulement renforcer tes réglages, c'est voulu ; le blocage se termine tout seul à l'heure affichée.
- **Tout supprimer** : désinstaller l'extension (dans `chrome://extensions`, clique sur Supprimer) efface toutes les données qu'elle a enregistrées dans ton navigateur.
- **Copie synchronisée** : si la synchronisation Chrome est activée, tu peux aussi supprimer les données que Chrome synchronise dans ton compte Google depuis les paramètres de synchronisation de Chrome.

## Ce que l'extension ne fait pas

- Elle ne collecte, n'enregistre et ne transmet pas ton historique de navigation.
- Elle ne lit pas le contenu des pages et n'injecte aucun script dans les pages que tu visites.
- Elle n'utilise ni cookies, ni statistiques, ni rapports de plantage, ni outils publicitaires.
- Elle ne charge aucun code distant. Chaque fichier exécuté est inclus dans le paquet examiné par le Chrome Web Store.
- Elle n'effectue aucune requête réseau de son côté<!--paid-->, sauf vers le serveur de paiement quand tu cliques sur Payer (voir « Payer pour arrêter une session »)<!--/paid-->.

## Les autorisations, expliquées

- **declarativeNetRequest** : permet à Chrome de bloquer les sites que tu as choisis, ou de les renvoyer vers la page de ton objectif, uniquement pendant un blocage. La correspondance se fait dans Chrome, à partir de tes groupes et de tes sites : l'extension ne voit pas ta navigation et rien n'est enregistré. À l'installation, Chrome prévient que l'extension peut bloquer du contenu sur n'importe quelle page (en anglais « Block content on any page ») ; en pratique, elle ne s'applique qu'aux sites de ta liste.
- **Accès aux sites que tu choisis (facultatif)** : jamais demandé à l'installation. Il est demandé uniquement pour les sites que tu décides de bloquer, au moment où tu les ajoutes, et sert seulement à afficher la page avec ton objectif au lieu de la page d'erreur de Chrome quand tu ouvres un de ces sites pendant un blocage, et à basculer vers cette page les onglets déjà ouverts sur ces sites. Si tu ne l'autorises pas, ces sites restent bloqués, avec la page d'erreur de Chrome. Tu peux vérifier ou retirer cet accès à tout moment dans `chrome://extensions`.
- **storage** : enregistre tes réglages et l'état décrit plus haut.
- **alarms** : démarre et termine les blocages à l'heure, reprend les créneaux après une session arrêtée avant la fin et met à jour le compte à rebours sur l'icône.
- **activeTab** : quand tu ouvres la fenêtre de l'extension, lui permet de lire l'adresse de l'onglet actif pour proposer « Bloquer ce site ». Seulement quand tu cliques sur l'icône, seulement cet onglet, jamais le contenu de la page.

<!--paid-->
## Payer pour arrêter une session (facultatif)

Si tu as choisi « Engagement avec argent », arrêter une session avant la fin peut coûter le montant que tu as choisi. Passer gratuitement (en tapant une phrase) reste toujours possible, et « Gratuit seulement » désactive les paiements. Quand tu cliques sur Payer, l'extension envoie trois choses au serveur de paiement : le montant, la langue de la page et un code aléatoire à usage unique créé pour ce paiement. Le serveur demande à Stripe d'ouvrir une page de paiement pour ce montant, puis demande à Stripe si le paiement est passé, pour que l'extension arrête ta session. Le serveur ne garde rien et ne reçoit aucune information sur ta navigation, tes réglages ou tes objectifs. Le paiement se fait chez Stripe et la politique de confidentialité de Stripe s'applique (https://stripe.com/privacy). L'argent va au développeur. La page Stripe propose un champ de message facultatif : si tu y écris quelque chose, le développeur peut le lire dans Stripe.
<!--/paid-->

## Le site web

Le site wedeepfocus.com (pas l'extension) utilise DataFast pour compter les visites : pages vues, site d'origine, pays, appareil et navigateur, et les clics sur quelques boutons (Ajouter à Chrome, la vidéo, GitHub et la démo de la page d'accueil). Ça nous aide à comprendre comment les gens découvrent WeDeepFocus. Le site signale aussi à DataFast quand un robot connu, comme un moteur de recherche ou un assistant d'IA, demande une page ; ça concerne les robots, pas les personnes. DataFast dépose un cookie pour reconnaître les visiteurs qui reviennent et sa politique de confidentialité s'applique (https://datafa.st/privacy). L'extension elle-même ne charge jamais DataFast et n'envoie rien.

## Ton avis

Le lien « Ton avis » du menu de l'extension ouvre la page de retour du site dans un nouvel onglet. Quand tu désinstalles l'extension, Chrome ouvre cette même page, pour que tu puisses dire pourquoi si tu le souhaites. Seuls la langue, l'endroit d'où tu viens (« menu » ou « désinstallation ») et la version de l'extension figurent dans son adresse ; l'extension n'envoie rien d'autre. Si tu envoies le formulaire, ton message et l'adresse email que tu choisis de donner (facultative) parviennent au développeur par email via Web3Forms (https://web3forms.com/privacy). Rien n'est envoyé tant que tu n'appuies pas sur Envoyer.

## Lien de soutien facultatif

Le lien « Offrir un café au dev » ouvre une page de paiement Stripe dans un nouvel onglet. L'extension n'envoie rien à Stripe. Si tu choisis de payer, le paiement se fait chez Stripe et c'est la politique de confidentialité de Stripe qui s'applique (https://stripe.com/privacy). Comme pour tout vendeur qui utilise Stripe, le développeur peut voir ce paiement dans Stripe (par exemple le montant et les informations que tu y saisis). Rien ne le relie à ton utilisation de l'extension.

## Enfants

L'extension ne collecte aucune information personnelle, y compris auprès des enfants.

## Modifications

Si cette politique change, la nouvelle version sera publiée à la même adresse avec une nouvelle date. Toute modification qui introduirait une collecte de données nécessiterait d'abord ton accord explicite.

## Contact

Questions : [contact]
