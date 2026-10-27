package com.msamods.androprint;

import android.util.Log;

/**
 * JNI Native Bridge to embedded Node.js C++ runtime (libnode.so & androprint-native).
 * Developed By : MSA MODS x WhatYouWantKerala
 */
public class NodeRunner {

    private static final String TAG = "AndroPrint::NodeRunner";
    private static boolean isNativeLibraryLoaded = false;

    static {
        try {
            System.loadLibrary("node");
            System.loadLibrary("androprint-native");
            isNativeLibraryLoaded = true;
            Log.i(TAG, "libnode.so and libandroprint-native.so loaded successfully");
        } catch (UnsatisfiedLinkError e) {
            Log.w(TAG, "Native library load issue: " + e.getMessage());
            isNativeLibraryLoaded = false;
        }
    }

    public static boolean isLoaded() {
        return isNativeLibraryLoaded;
    }

    /**
     * Starts Node.js runtime with arguments on the calling thread.
     * This call blocks until Node.js exits, so run it on a background worker thread.
     */
    public static native Integer startNodeWithArguments(String[] arguments);
}
