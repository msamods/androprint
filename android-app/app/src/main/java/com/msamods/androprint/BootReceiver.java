package com.msamods.androprint;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;
import androidx.core.content.ContextCompat;

/**
 * BroadcastReceiver that automatically starts AndroPrint PrintServerService
 * whenever the Android device boots, reboots, or after an app update.
 * Guarantees 24/7 autonomous thermal printing operation.
 */
public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "AndroPrint::BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        Log.i(TAG, "Broadcast received: " + action);

        if (Intent.ACTION_BOOT_COMPLETED.equals(action) ||
            "android.intent.action.QUICKBOOT_POWERON".equals(action) ||
            "com.htc.intent.action.QUICKBOOT_POWERON".equals(action) ||
            Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {

            SharedPreferences prefs = context.getSharedPreferences("server_state", Context.MODE_PRIVATE);
            // Autostart on boot is enabled by default
            boolean shouldAutostart = prefs.getBoolean("autostart_on_boot", true);
            boolean wasRunning = prefs.getBoolean("is_running", true);

            if (shouldAutostart || wasRunning) {
                Log.i(TAG, "Autostarting AndroPrint 24/7 Thermal Gateway Daemon after boot/update...");
                try {
                    Intent serviceIntent = new Intent(context, PrintServerService.class);
                    ContextCompat.startForegroundService(context, serviceIntent);
                } catch (Throwable t) {
                    Log.e(TAG, "Failed to autostart service: " + t.getMessage(), t);
                }
            } else {
                Log.i(TAG, "Autostart disabled by user preference.");
            }
        }
    }
}
