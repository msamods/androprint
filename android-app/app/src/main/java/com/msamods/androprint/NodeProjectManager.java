package com.msamods.androprint;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.res.AssetManager;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Manages extraction and runtime sandbox directory for AndroPrint Node.js project.
 * Assets inside an APK are read-only; this manager extracts them to internal storage
 * so SQLite, SSL certificates, JSON queues, and logs have full Read/Write permissions.
 *
 * Developed By : MSA MODS x WhatYouWantKerala
 */
public class NodeProjectManager {

    private static final String TAG = "AndroPrint::Project";
    private static final String NODE_PROJECT_FOLDER = "nodejs-project";
    private static final String PREF_NAME = "androprint_project_prefs";
    private static final String KEY_EXTRACTED_VERSION = "extracted_version";

    public static File getProjectDir(Context context) {
        return new File(context.getFilesDir(), NODE_PROJECT_FOLDER);
    }

    public static boolean ensureProjectExtracted(Context context) {
        File targetDir = getProjectDir(context);
        int currentVersionCode = getAppVersionCode(context);

        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        int lastVersion = prefs.getInt(KEY_EXTRACTED_VERSION, -1);

        if (!targetDir.exists() || lastVersion != currentVersionCode) {
            Log.i(TAG, "Extracting nodejs-project from APK assets to " + targetDir.getAbsolutePath());
            boolean success = copyAssetFolder(context.getAssets(), NODE_PROJECT_FOLDER, targetDir);
            if (success) {
                prefs.edit().putInt(KEY_EXTRACTED_VERSION, currentVersionCode).apply();
                Log.i(TAG, "Extraction completed successfully!");
            } else {
                Log.e(TAG, "Failed to extract some project assets.");
            }
            return success;
        }

        return true;
    }

    private static boolean copyAssetFolder(AssetManager assetManager, String fromAssetPath, File toDir) {
        try {
            String[] files = assetManager.list(fromAssetPath);
            if (files == null || files.length == 0) {
                // If it's a file, copy it directly
                return copyAssetFile(assetManager, fromAssetPath, toDir);
            }

            if (!toDir.exists() && !toDir.mkdirs()) {
                return false;
            }

            for (String file : files) {
                String subAssetPath = fromAssetPath.isEmpty() ? file : fromAssetPath + "/" + file;
                File targetFile = new File(toDir, file);

                String[] subFiles = assetManager.list(subAssetPath);
                if (subFiles != null && subFiles.length > 0) {
                    copyAssetFolder(assetManager, subAssetPath, targetFile);
                } else {
                    copyAssetFile(assetManager, subAssetPath, targetFile);
                }
            }
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Error copying asset folder " + fromAssetPath, e);
            return false;
        }
    }

    private static boolean copyAssetFile(AssetManager assetManager, String assetPath, File destFile) {
        try {
            File parent = destFile.getParentFile();
            if (parent != null && !parent.exists()) {
                parent.mkdirs();
            }

            try (InputStream in = assetManager.open(assetPath);
                 OutputStream out = new FileOutputStream(destFile)) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                }
            }

            // Set executable if in bin
            if (destFile.getName().equals("node") || destFile.getParent().endsWith("bin")) {
                destFile.setExecutable(true, false);
            }

            return true;
        } catch (Exception e) {
            Log.w(TAG, "Cannot copy asset file " + assetPath + ": " + e.getMessage());
            return false;
        }
    }

    private static int getAppVersionCode(Context context) {
        try {
            PackageInfo pInfo = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return pInfo.versionCode;
        } catch (Exception e) {
            return 1;
        }
    }
}
