package com.msamods.androprint;

import android.util.Log;

/**
 * JNI Native Bridge to embedded Node.js C++ runtime (libnode.so).
 * Developed By : MSA MODS x WhatYouWantKerala
 */
public class NodeRunner {

    private static final String TAG = "AndroPrint::NodeRunner";
    private static boolean isNativeLibraryLoaded = false;

    static {
        try {
            System.loadLibrary("node");
            isNativeLibraryLoaded = true;
            Log.i(TAG, "libnode.so native runtime loaded successfully");
        } catch (UnsatisfiedLinkError e) {
            Log.w(TAG, "libnode.so native library not present in jniLibs: " + e.getMessage());
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
