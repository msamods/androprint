package com.msamods.androprint;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.net.http.SslError;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.text.format.Formatter;
import android.view.View;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * AndroPrint Main Activity
 * Features Native Controller HUD + In-App Fullscreen WebView with Auto-SSL & Strict No-Zoom.
 * Includes In-App GitHub Releases Auto-Updater with 1-Click APK Installer.
 *
 * Developed By : MSA MODS x WhatYouWantKerala
 */
public class MainActivity extends AppCompatActivity {

    private TextView tvServerStatus;
    private TextView tvServerUrl;
    private TextView tvDeviceIp;
    private TextView tvLogConsole;
    private Button btnToggleServer;
    private Button btnOpenDashboard;
    private Button btnCheckUpdate;

    private Button btnTabHud;
    private Button btnTabDashboard;
    private LinearLayout layoutHud;
    private WebView webView;

    private boolean isServerRunning = false;
    private String localDashboardUrl = "https://localhost:3000/dashboard.html";
    private String currentAppVersion = "2.0.1";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // Bind Views
        tvServerStatus = findViewById(R.id.tvServerStatus);
        tvServerUrl = findViewById(R.id.tvServerUrl);
        tvDeviceIp = findViewById(R.id.tvDeviceIp);
        tvLogConsole = findViewById(R.id.tvLogConsole);
        btnToggleServer = findViewById(R.id.btnToggleServer);
        btnOpenDashboard = findViewById(R.id.btnOpenDashboard);
        btnCheckUpdate = findViewById(R.id.btnCheckUpdate);

        try {
            PackageInfo pInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
            currentAppVersion = pInfo.versionName;
            btnCheckUpdate.setText("CHECK FOR UPDATES (v" + currentAppVersion + ")");
        } catch (Exception ignored) {}

        btnCheckUpdate.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                checkForUpdates(true);
            }
        });

        btnTabHud = findViewById(R.id.btnTabHud);
        btnTabDashboard = findViewById(R.id.btnTabDashboard);
        layoutHud = findViewById(R.id.layoutHud);
        webView = findViewById(R.id.webView);

        detectWifiIp();
        setupWebView();

        // Request Notification permission for Android 13+ (API 33+)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 101);
            }
        }

        // Check if service is already running
        isServerRunning = PrintServerService.isServerRunning();
        updateServerUiState(isServerRunning);

        btnToggleServer.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                toggleServer();
            }
        });

        btnOpenDashboard.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                switchToTab(false);
            }
        });

        btnTabHud.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                switchToTab(true);
            }
        });

        btnTabDashboard.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                switchToTab(false);
            }
        });
    }

    private void switchToTab(boolean showHud) {
        if (showHud) {
            layoutHud.setVisibility(View.VISIBLE);
            webView.setVisibility(View.GONE);
            btnTabHud.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xFF6366F1));
            btnTabHud.setTextColor(0xFFFFFFFF);
            btnTabDashboard.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xFF1F2937));
            btnTabDashboard.setTextColor(0xFF94A3B8);
        } else {
            layoutHud.setVisibility(View.GONE);
            webView.setVisibility(View.VISIBLE);
            btnTabDashboard.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xFF6366F1));
            btnTabDashboard.setTextColor(0xFFFFFFFF);
            btnTabHud.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xFF1F2937));
            btnTabHud.setTextColor(0xFF94A3B8);

            // Load dashboard if needed
            if (webView.getUrl() == null || webView.getUrl().isEmpty()) {
                webView.loadUrl(localDashboardUrl);
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);

        // Strict Mobile No-Zooming Configuration
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // Auto-trust local print server SSL certificate on localhost & LAN
                handler.proceed();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                if (request != null && request.getUrl() != null) {
                    view.loadUrl(request.getUrl().toString());
                    return true;
                }
                return false;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url != null) {
                    view.loadUrl(url);
                    return true;
                }
                return false;
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                super.onReceivedError(view, errorCode, description, failingUrl);
                if (failingUrl != null && failingUrl.startsWith("https://localhost:")) {
                    String httpFallback = failingUrl.replace("https://", "http://");
                    view.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            view.loadUrl(httpFallback);
                        }
                    }, 500);
                }
            }
        });

        webView.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public void checkUpdate() {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        checkForUpdates(true);
                    }
                });
            }

            @android.webkit.JavascriptInterface
            public void installUpdate(final String url, final String version) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        downloadAndInstallApk(url, version);
                    }
                });
            }

            @android.webkit.JavascriptInterface
            public String getAppVersion() {
                return currentAppVersion;
            }
        }, "AndroidApp");
    }

    private void detectWifiIp() {
        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                String ip = Formatter.formatIpAddress(wm.getConnectionInfo().getIpAddress());
                if (!ip.equals("0.0.0.0")) {
                    tvDeviceIp.setText("Wi-Fi IP: " + ip);
                    tvServerUrl.setText("LAN URL: https://" + ip + ":3000");
                } else {
                    tvDeviceIp.setText("Wi-Fi IP: Not Connected (Hotspot/Localhost only)");
                }
            }
        } catch (Exception e) {
            tvDeviceIp.setText("Wi-Fi IP: " + e.getMessage());
        }
    }

    private void toggleServer() {
        Intent serviceIntent = new Intent(this, PrintServerService.class);

        if (!isServerRunning) {
            try {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    startForegroundService(serviceIntent);
                } else {
                    startService(serviceIntent);
                }
                isServerRunning = true;
                updateServerUiState(true);
                appendLog("[INFO] Node.js Native Print Gateway starting on port 3000...");
                appendLog("[INFO] Auto-SSL (https://localhost:3000) active with WakeLock");
                Toast.makeText(this, "Print Server Started!", Toast.LENGTH_SHORT).show();

                // Refresh webview after delay to allow server listen
                webView.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        webView.loadUrl(localDashboardUrl);
                    }
                }, 2000);
            } catch (Throwable t) {
                appendLog("[ERROR] Failed to start service: " + t.getMessage());
                Toast.makeText(this, "Failed to start service: " + t.getMessage(), Toast.LENGTH_LONG).show();
            }
        } else {
            try {
                stopService(serviceIntent);
            } catch (Throwable ignored) {}
            isServerRunning = false;
            updateServerUiState(false);
            appendLog("[INFO] Print Gateway stopped.");
            Toast.makeText(this, "Print Server Stopped", Toast.LENGTH_SHORT).show();
        }
    }

    private void updateServerUiState(boolean running) {
        if (running) {
            tvServerStatus.setText("Server Status: RUNNING (Port 3000)");
            tvServerStatus.setTextColor(0xFF10B981); // Emerald Green
            btnToggleServer.setText("STOP PRINT SERVICE");
            btnToggleServer.setBackgroundColor(0xFFEF4444); // Red
        } else {
            tvServerStatus.setText("Server Status: STOPPED");
            tvServerStatus.setTextColor(0xFFEF4444);
            btnToggleServer.setText("START PRINT SERVICE");
            btnToggleServer.setBackgroundColor(0xFF10B981); // Green
        }
    }

    private void appendLog(String message) {
        tvLogConsole.append(message + "\n");
    }

    private android.os.Handler statusCheckHandler = new android.os.Handler();
    private Runnable statusCheckRunnable = new Runnable() {
        @Override
        public void run() {
            checkLivePortStatus();
            statusCheckHandler.postDelayed(this, 3000);
        }
    };

    private void checkLivePortStatus() {
        new Thread(new Runnable() {
            @Override
            public void run() {
                boolean running = false;
                try {
                    java.net.Socket socket = new java.net.Socket();
                    socket.connect(new java.net.InetSocketAddress("127.0.0.1", 3000), 400);
                    socket.close();
                    running = true;
                } catch (Exception ignored) {
                    running = PrintServerService.isServerRunning();
                }

                final boolean isAlive = running;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        isServerRunning = isAlive;
                        updateServerUiState(isAlive);
                    }
                });
            }
        }).start();
    }

    @Override
    protected void onResume() {
        super.onResume();
        checkLivePortStatus();
        statusCheckHandler.postDelayed(statusCheckRunnable, 3000);
    }

    @Override
    protected void onPause() {
        super.onPause();
        statusCheckHandler.removeCallbacks(statusCheckRunnable);
    }

    private void checkForUpdates(final boolean userInitiated) {
        if (userInitiated) {
            Toast.makeText(this, "Checking GitHub for updates...", Toast.LENGTH_SHORT).show();
            btnCheckUpdate.setText("CHECKING...");
        }

        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection conn = null;
                try {
                    URL url = new URL("https://api.github.com/repos/msamods/androprint/releases/latest");
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestProperty("User-Agent", "AndroPrint-App");
                    conn.setConnectTimeout(6000);
                    conn.setReadTimeout(6000);

                    if (conn.getResponseCode() == 200) {
                        InputStream in = conn.getInputStream();
                        java.util.Scanner scanner = new java.util.Scanner(in).useDelimiter("\\A");
                        String result = scanner.hasNext() ? scanner.next() : "";
                        in.close();

                        JSONObject release = new JSONObject(result);
                        final String tagName = release.optString("tag_name", "").replace("v", "");
                        final String releaseNotes = release.optString("body", "New features & performance improvements.");

                        String apkDownloadUrl = null;
                        JSONArray assets = release.optJSONArray("assets");
                        if (assets != null) {
                            for (int i = 0; i < assets.length(); i++) {
                                JSONObject asset = assets.getJSONObject(i);
                                String name = asset.optString("name", "");
                                if (name.endsWith(".apk")) {
                                    apkDownloadUrl = asset.optString("browser_download_url", "");
                                    break;
                                }
                            }
                        }

                        final String finalApkUrl = apkDownloadUrl;
                        final boolean isNewer = isVersionNewer(tagName, currentAppVersion);

                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                btnCheckUpdate.setText("CHECK FOR UPDATES (v" + currentAppVersion + ")");
                                if (isNewer && finalApkUrl != null && !finalApkUrl.isEmpty()) {
                                    showUpdateDialog(tagName, releaseNotes, finalApkUrl);
                                } else if (userInitiated) {
                                    Toast.makeText(MainActivity.this, "AndroPrint is up to date (v" + currentAppVersion + ")!", Toast.LENGTH_SHORT).show();
                                }
                            }
                        });
                    } else if (userInitiated) {
                        final int code = conn.getResponseCode();
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                btnCheckUpdate.setText("CHECK FOR UPDATES (v" + currentAppVersion + ")");
                                Toast.makeText(MainActivity.this, "Could not check updates (HTTP " + code + ")", Toast.LENGTH_SHORT).show();
                            }
                        });
                    }
                } catch (final Exception e) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            btnCheckUpdate.setText("CHECK FOR UPDATES (v" + currentAppVersion + ")");
                            if (userInitiated) {
                                Toast.makeText(MainActivity.this, "Update check notice: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                            }
                        }
                    });
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }
        }).start();
    }

    private boolean isVersionNewer(String latest, String current) {
        if (latest == null || latest.isEmpty()) return false;
        try {
            String[] lParts = latest.split("\\.");
            String[] cParts = current.split("\\.");
            int length = Math.max(lParts.length, cParts.length);
            for (int i = 0; i < length; i++) {
                int l = i < lParts.length ? Integer.parseInt(lParts[i].replaceAll("[^0-9]", "")) : 0;
                int c = i < cParts.length ? Integer.parseInt(cParts[i].replaceAll("[^0-9]", "")) : 0;
                if (l > c) return true;
                if (l < c) return false;
            }
        } catch (Exception ignored) {}
        return !latest.equals(current);
    }

    private void showUpdateDialog(final String newVersion, String notes, final String downloadUrl) {
        new AlertDialog.Builder(this)
                .setTitle("🚀 New Version Available: v" + newVersion)
                .setMessage("A new update is available on GitHub with fixes and improvements.\n\nWould you like to download and install this update inside the app now?")
                .setPositiveButton("DOWNLOAD & INSTALL", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        downloadAndInstallApk(downloadUrl, newVersion);
                    }
                })
                .setNegativeButton("LATER", null)
                .show();
    }

    private void downloadAndInstallApk(final String downloadUrl, final String version) {
        // Check unknown source install permission on Android 8+ (Oreo+)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            if (!getPackageManager().canRequestPackageInstalls()) {
                new AlertDialog.Builder(this)
                        .setTitle("Permission Required")
                        .setMessage("To install updates directly inside AndroPrint, please enable 'Allow from this source'.")
                        .setPositiveButton("OPEN SETTINGS", new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface d, int w) {
                                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                                intent.setData(Uri.parse("package:" + getPackageName()));
                                startActivity(intent);
                            }
                        })
                        .setNegativeButton("CANCEL", null)
                        .show();
                return;
            }
        }

        final ProgressDialog progressDialog = new ProgressDialog(this);
        progressDialog.setTitle("Downloading AndroPrint v" + version);
        progressDialog.setMessage("Downloading APK package from GitHub releases...");
        progressDialog.setProgressStyle(ProgressDialog.STYLE_HORIZONTAL);
        progressDialog.setIndeterminate(false);
        progressDialog.setMax(100);
        progressDialog.setCancelable(false);
        progressDialog.show();

        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection connection = null;
                try {
                    URL url = new URL(downloadUrl);
                    connection = (HttpURLConnection) url.openConnection();
                    connection.setRequestProperty("User-Agent", "AndroPrint-App");
                    connection.setInstanceFollowRedirects(true);
                    connection.connect();

                    int status = connection.getResponseCode();
                    if (status == HttpURLConnection.HTTP_MOVED_TEMP || status == HttpURLConnection.HTTP_MOVED_PERM || status == 307 || status == 302) {
                        String newUrl = connection.getHeaderField("Location");
                        connection.disconnect();
                        connection = (HttpURLConnection) new URL(newUrl).openConnection();
                        connection.setRequestProperty("User-Agent", "AndroPrint-App");
                        connection.connect();
                    }

                    final int fileLength = connection.getContentLength();
                    File destDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (destDir == null) destDir = getCacheDir();
                    final File apkFile = new File(destDir, "AndroPrint-v" + version + "-update.apk");

                    InputStream input = connection.getInputStream();
                    FileOutputStream output = new FileOutputStream(apkFile);

                    byte[] data = new byte[8192];
                    long total = 0;
                    int count;
                    while ((count = input.read(data)) != -1) {
                        total += count;
                        if (fileLength > 0) {
                            final int progress = (int) (total * 100 / fileLength);
                            runOnUiThread(new Runnable() {
                                @Override
                                public void run() {
                                    progressDialog.setProgress(progress);
                                }
                            });
                        }
                        output.write(data, 0, count);
                    }

                    output.flush();
                    output.close();
                    input.close();

                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            progressDialog.dismiss();
                            installDownloadedApk(apkFile);
                        }
                    });
                } catch (final Exception e) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            progressDialog.dismiss();
                            Toast.makeText(MainActivity.this, "Download failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
                        }
                    });
                } finally {
                    if (connection != null) connection.disconnect();
                }
            }
        }).start();
    }

    private void installDownloadedApk(File apkFile) {
        try {
            Uri apkUri = FileProvider.getUriForFile(
                    this,
                    getPackageName() + ".provider",
                    apkFile
            );

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception e) {
            Toast.makeText(this, "Failed to launch installer: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.getVisibility() == View.VISIBLE) {
            if (webView.canGoBack()) {
                webView.goBack();
            } else {
                switchToTab(true);
            }
        } else {
            super.onBackPressed();
        }
    }
}
