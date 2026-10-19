package com.msamods.androprint;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.text.format.Formatter;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;

/**
 * AndroPrint Main Activity
 * Developed By : MSA MODS x WhatYouWantKerala
 */
public class MainActivity extends AppCompatActivity {

    private TextView tvServerStatus;
    private TextView tvServerUrl;
    private TextView tvDeviceIp;
    private TextView tvLogConsole;
    private Button btnToggleServer;
    private Button btnOpenDashboard;

    private boolean isServerRunning = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        tvServerStatus = findViewById(R.id.tvServerStatus);
        tvServerUrl = findViewById(R.id.tvServerUrl);
        tvDeviceIp = findViewById(R.id.tvDeviceIp);
        tvLogConsole = findViewById(R.id.tvLogConsole);
        btnToggleServer = findViewById(R.id.btnToggleServer);
        btnOpenDashboard = findViewById(R.id.btnOpenDashboard);

        detectWifiIp();

        btnToggleServer.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                toggleServer();
            }
        });

        btnOpenDashboard.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openDashboardInBrowser();
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
                    tvServerUrl.setText("LAN URL: http://" + ip + ":3000");
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
            tvServerStatus.setText("Server Status: RUNNING (Port 3000)");
            tvServerStatus.setTextColor(0xFF10B981); // Emerald Green
            btnToggleServer.setText("STOP PRINT SERVICE");
            btnToggleServer.setBackgroundColor(0xFFEF4444); // Red
            appendLog("[INFO] Node.js Print Gateway started on port 3000");
            appendLog("[INFO] ESC/POS TCP & Cloud Engine active");
            Toast.makeText(this, "Print Server Started!", Toast.LENGTH_SHORT).show();
        } else {
            stopService(serviceIntent);
            isServerRunning = false;
            tvServerStatus.setText("Server Status: STOPPED");
            tvServerStatus.setTextColor(0xFFEF4444);
            btnToggleServer.setText("START PRINT SERVICE");
            btnToggleServer.setBackgroundColor(0xFF10B981);
            appendLog("[INFO] Print Gateway stopped.");
            Toast.makeText(this, "Print Server Stopped", Toast.LENGTH_SHORT).show();
        }
    }

    private void openDashboardInBrowser() {
        String url = "http://127.0.0.1:3000";
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        startActivity(intent);
    }

    private void appendLog(String log) {
        String current = tvLogConsole.getText().toString();
        tvLogConsole.setText(current + "\n" + log);
    }
}
