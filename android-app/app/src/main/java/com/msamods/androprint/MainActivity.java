package com.msamods.androprint;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.net.http.SslError;
import android.net.wifi.WifiManager;
import android.os.Bundle;
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

/**
 * AndroPrint Main Activity
 * Features Native Controller HUD + In-App Fullscreen WebView with Auto-SSL & Strict No-Zoom.
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

    private Button btnTabHud;
    private Button btnTabDashboard;
    private LinearLayout layoutHud;
    private WebView webView;

    private boolean isServerRunning = false;
    private String localDashboardUrl = "https://localhost:3000/dashboard.html";

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

        btnTabHud = findViewById(R.id.btnTabHud);
        btnTabDashboard = findViewById(R.id.btnTabDashboard);
        layoutHud = findViewById(R.id.layoutHud);
        webView = findViewById(R.id.webView);

        detectWifiIp();
        setupWebView();

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

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // Auto-trust our own local print server SSL certificate on localhost & LAN
                String url = view.getUrl();
                if (url != null && (url.contains("localhost") || url.contains("127.0.0.1") || url.contains("192.168."))) {
                    handler.proceed(); // Bypass untrusted certificate alert seamlessly!
                } else {
                    handler.cancel();
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // Keep inside webview for localhost routes
                if (url.contains("localhost") || url.contains("127.0.0.1")) {
                    view.loadUrl(url);
                    return true;
                }
                return false;
            }
        });
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
            startService(serviceIntent);
            isServerRunning = true;
            updateServerUiState(true);
            appendLog("[INFO] Node.js Native Print Gateway started on port 3000");
            appendLog("[INFO] Auto-SSL (https://localhost:3000) active with WakeLock");
            Toast.makeText(this, "Print Server Started!", Toast.LENGTH_SHORT).show();

            // Refresh webview after delay to allow server listen
            webView.postDelayed(new Runnable() {
                @Override
                public void run() {
                    webView.loadUrl(localDashboardUrl);
                }
            }, 1500);
        } else {
            stopService(serviceIntent);
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
