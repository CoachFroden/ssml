# SSML Noter

## Publisering på GitHub Pages

Last opp alle filene i denne mappen til samme mappe i GitHub-repositoriet. Slå deretter på GitHub Pages under **Settings → Pages** og velg grenen som inneholder filene.

På iPhone åpner du den publiserte nettsiden i Safari, trykker **Del**, og velger **Legg til på Hjem-skjermen**. Appen bruker da SSML-logoen som ikon.

Første fungerande versjon av notearkivet for Samnanger Skulemusikklag, laga med rein HTML, CSS og JavaScript.

## Start appen

Appen må køyrast frå ein liten lokal webserver (ikkje ved å dobbeltklikke på `index.html`).

Med Python installert:

```powershell
cd sti\til\ssml-noter
python -m http.server 8080
```

Opne deretter `http://localhost:8080`. Klikk **Prøv demo utan Firebase** for å teste appen med ein gong.

## Kople til Firebase

1. Opne prosjektet **Samnanger skulemusikklag** i Firebase Console.
2. Slå på **Authentication → Email/Password**.
3. Opprett minst éin brukar under Authentication → Users.
4. Opprett **Cloud Firestore** og **Storage**.
5. Registrer ei web-app under Project settings og lim inn konfigurasjonen i `firebase.js`.
6. Køyr appen på nytt. Når alle placeholder-verdiane er erstatta, bruker appen Firebase automatisk.

## Automatisk PDF-analyse

Appen bruker Firebase AI Logic med Agent Platform Gemini API og modellen `gemini-3.6-flash`. Ved import blir PDF-en analysert for tittel, komponist, arrangør, instrument, stemme og sidetal. Brukaren kontrollerer alltid forslaget før det blir lagra. AI blir berre kalla ved ny import.

Firebase AI Logic og reCAPTCHA Enterprise App Check må vere aktiverte. For lokal utvikling skriv appen ut ein App Check debug-token i nettlesarkonsollen. Registrer denne under App Check → SSML noter → Manage debug tokens. Fjern lokal debug-modus ved produksjonssetting.

For produksjon må Firestore- og Storage-reglane avgrense lesing og skriving til innlogga brukarar. Firebase sin `apiKey` for ei web-app er ikkje ein hemmeleg nøkkel; tryggleiken ligg i Authentication og security rules. Aldri legg ein service-account/private key i nettlesarkoden.

## Datastruktur

Firestore-samlinga `songs` inneheld dokument med tittel, komponist, arrangør, PDF-modus og ei liste med stemmer. PDF-filene blir lagra under `songs/{songId}/` i Firebase Storage.

```text
sang
└── stemmer / PDF-filer
    └── sider (blir lesne direkte frå PDF-en i nettlesaren)
```

## Avgrensingar i første versjon

- Demo-import lagrar metadata lokalt, men nettlesaren kan ikkje behalde sjølve PDF-fila etter at fana er lukka. Firebase-modus lagrar fila permanent.
- AI-resultat må kontrollerast: svake skanningar eller uvanlege noteark kan gi feil forslag.
- Talet på kopiar må veljast i utskriftsvindauget til operativsystemet; appen minner brukaren på det.
- Utskrifta blir klargjord i appen utan å opne eit tomt `about:blank`-faneblad.
- PDF-miniatyrar blir laga med PDF.js frå CDN, så første innlasting krev nettilgang.

## Redigering

- Trykk **Rediger informasjon** på songen for å endre tittel, komponist og arrangør.
- Vel ei stemme og trykk **Rediger instrument** for å endre instrumentnamnet.
- Trykk **Slett side** under ein miniatyr for å fjerne sida frå den aktuelle stemma.
- Original-PDF-en blir ikkje endra når ei enkeltside blir fjerna. Sida kan derfor leggjast tilbake seinare ved å redigere stemmefordelinga.

## Filer

- `index.html` – struktur og innhald
- `style.css` – design og responsivt oppsett
- `features.css` – stil for stemmefordeling og stor notevisning
- `app.js` – brukargrensesnitt, søk, import, PDF-vising og utskrift
- `firebase.js` – Firebase-konfigurasjon, innlogging, Firestore og Storage
