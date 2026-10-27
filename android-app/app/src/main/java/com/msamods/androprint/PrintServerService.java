package com.msamods.androprint;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;
import androidx.core.app.NotificationCompat;

import java.io.File;

/**
 * Foreground Service that keeps AndroPrint Node.js print daemon
 * alive in the background without being killed by Android battery optimization.
 * Developed By : MSA MODS x WhatYouWantKerala
 */
public class PrintServerService extends Service {

    private static final String TAG = "AndroPrint::Service";
    private static final String CHANNEL_ID = "AndroPrintServiceChannel";
    private static final int NOTIFICATION_ID = 8921;

    private PowerManager.WakeLock wakeLock;
    private Thread nodeThread;
    private Process nodeProcess;
    private static boolean isRunning = false;

    public static boolean isServerRunning() {
        return isRunning;
    }

    @Override
    public void onCreate() {
        super.onCreate();

        // 1. Create notification channel and start foreground IMMEDIATELY to satisfy Android O-14 requirements
        createNotificationChannel();
        startForegroundNotification();

        // 2. Acquire WakeLock so printing never sleeps
        try {
            PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (powerManager != null) {
                wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AndroPrint::PrintServerWakelock");
                wakeLock.acquire();
                Log.i(TAG, "Android CPU WakeLock acquired for 24/7 printing");
            }
        } catch (Throwable t) {
            Log.w(TAG, "WakeLock acquire warning: " + t.getMessage());
        }

        // 3. Start Node.js Engine
        startNodePrintEngine();
        isRunning = true;
    }

    private void startForegroundNotification() {
        try {
            Intent notificationIntent = new Intent(this, MainActivity.class);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                    this, 0, notificationIntent,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
            );

            android.graphics.Bitmap largeLogo = null;
            try {
                largeLogo = android.graphics.BitmapFactory.decodeResource(getResources(), R.drawable.app_logo);
            } catch (Throwable ignored) {}

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                    .setContentTitle("AndroPrint Active")
                    .setContentText("ESC/POS Thermal Print Gateway is running (Port 3000)")
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .setContentIntent(pendingIntent)
                    .setOngoing(true)
                    .setPriority(NotificationCompat.PRIORITY_LOW);

            if (largeLogo != null) {
                builder.setLargeIcon(largeLogo);
            }

            Notification notification = builder.build();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE | ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
                startForeground(NOTIFICATION_ID, notification, type);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            Log.i(TAG, "Foreground notification started successfully");
        } catch (Throwable e) {
            Log.e(TAG, "Failed to start foreground notification", e);
        }
    }

    private void startNodePrintEngine() {
        nodeThread = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    // Extract project files if needed
                    NodeProjectManager.ensureProjectExtracted(getApplicationContext());
                    File projectDir = NodeProjectManager.getProjectDir(getApplicationContext());
                    File serverJs = new File(projectDir, "server.js");

                    Log.i(TAG, "Starting AndroPrint Gateway from: " + serverJs.getAbsolutePath());

                    // Check if JNI native library libnode.so is loaded
                    if (NodeRunner.isLoaded()) {
                        Log.i(TAG, "Executing via libnode.so Native JNI runtime");
                        NodeRunner.startNodeWithArguments(new String[]{
                                "node",
                                serverJs.getAbsolutePath()
                        }, projectDir.getAbsolutePath());
                    } else {
                        // Fallback: Check if embedded node binary exists in bin/node
                        File nodeBin = new File(projectDir, "bin/node");
                        if (!nodeBin.exists()) {
                            nodeBin = new File(getFilesDir(), "node");
                        }

                        if (nodeBin.exists()) {
                            nodeBin.setExecutable(true);
                            Log.i(TAG, "Executing via standalone binary: " + nodeBin.getAbsolutePath());
                            ProcessBuilder pb = new ProcessBuilder(nodeBin.getAbsolutePath(), serverJs.getAbsolutePath());
                            pb.directory(projectDir);
                            nodeProcess = pb.start();
                            nodeProcess.waitFor();
                        } else {
                            Log.w(TAG, "Embedded Node runtime pending. Termux or remote node fallback active.");
                        }
                    }
                } catch (Throwable e) {
                    Log.e(TAG, "Error in Node print engine thread", e);
                }
            }
        }, "AndroPrintNodeEngineThread");

        nodeThread.start();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForegroundNotification();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        isRunning = false;

        if (nodeProcess != null) {
            try {
                nodeProcess.destroy();
            } catch (Exception ignored) {}
        }

        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
                Log.i(TAG, "WakeLock released");
            } catch (Throwable ignored) {}
        }

        Log.i(TAG, "PrintServerService stopped");
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel serviceChannel = new NotificationChannel(
                    CHANNEL_ID,
                    "AndroPrint Server Background Channel",
                    NotificationManager.IMPORTANCE_LOW
            );
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(serviceChannel);
            }
        }
    }
}
