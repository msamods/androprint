# 📱 AndroPrint Native Android Print Agent (APK Project)

<p align="center">
  <b>Developed By : MSA MODS x WhatYouWantKerala</b>
</p>

This folder contains the complete native Android Application source code for **AndroPrint**.

## ✨ Features
- **One-Touch Server Toggle**: Single green/red button to Start / Stop the background print gateway.
- **Android Foreground Service (`PrintServerService`)**: Prevents Android battery managers (Doze Mode) from killing the printer server.
- **Wakelock Support**: Ensures continuous print job listening over Wi-Fi and Bluetooth.
- **Auto Wi-Fi IP Detection**: Automatically displays the Android phone's LAN IP address and port `3000`.
- **One-Click Web Dashboard**: Opens the futuristic glassmorphic UI (`http://127.0.0.1:3000`) inside the device browser.
- **Live Terminal Console**: Shows live socket connections, ESC/POS hardware print events, and error logs.

---

## 🛠️ How to Build the APK

### Method 1: Using Android Studio (Recommended)
1. Open **Android Studio**.
2. Select **Open an Existing Project** and navigate to:
   ```
   androprint/android-app
   ```
3. Wait for Gradle Sync to complete.
4. Click **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
5. Your installable `.apk` file will be generated at:
   ```
   app/build/outputs/apk/debug/app-debug.apk
   ```

### Method 2: Command Line (Gradle)
```bash
cd android-app
./gradlew assembleRelease
```
