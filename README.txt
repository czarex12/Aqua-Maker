AQUA MAKER v.1.1 — aplikacja desktopowa (Electron)
==============================================

Natywna apka desktopowa (Windows / Linux / macOS) do Aqua Maker —
kreatora botów Discord na blokach. Apka otwiera panel Aqua Maker
w natywnym oknie i zapamiętuje sesję logowania między uruchomieniami
(trwałe ciasteczka). Pozwala też uruchamiać wyeksportowanego bota
lokalnie na komputerze, jednym kliknięciem — do szybkich testów
przed wgraniem na hosting.

Ten folder zawiera WYŁĄCZNIE część desktopową (Electron). Panel
i backend (strona + API) hostowane są osobno i nie są częścią
tego repozytorium.

Wymagania
---------
- Node.js 18+ i npm
- Zainstalowany "node" dostępny w PATH — potrzebny, żeby apka mogła
  uruchamiać wyeksportowanego bota lokalnie (funkcja "Uruchom bota
  lokalnie")

Uruchomienie w trybie deweloperskim
------------------------------------
    npm install
    npm start

Apka otworzy się jako natywne okno i wczyta panel Aqua Maker
z hostingu. Logowanie wymagane jest tylko raz — sesja jest
zapamiętywana lokalnie między uruchomieniami.

Budowanie instalatora
-----------------------
    npm run build:win     # Windows (.exe / NSIS)
    npm run build:linux   # Linux (.AppImage)
    npm run build:mac     # macOS (.dmg)

Gotowe pliki instalacyjne pojawią się w folderze electron/dist.

Struktura plików
-----------------
main.js          - proces główny Electron: okno, sesja, wykrywanie
                    awarii strony, uruchamianie/zatrzymywanie bota
                    lokalnie
preload.js       - bezpieczny most (contextBridge) między stroną
                    a procesem głównym
error.html       - ekran zastępczy pokazywany, gdy panel Aqua Maker
                    jest niedostępny
package.json     - zależności i konfiguracja electron-builder
icon.png         - ikona aplikacji

Licencja
--------
Kod własnościowy Aqua Studios. Wszystkie prawa zastrzeżone.