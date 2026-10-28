#include <jni.h>
#include <string>
#include <cstdlib>
#include <cstring>
#include <unistd.h>
#include <pthread.h>
#include <android/log.h>
#include "node.h"

#define TAG "AndroPrint::NodeNative"

// Redirect stdout and stderr to Android logcat
static int pipe_stdout[2];
static int pipe_stderr[2];
static pthread_t thread_stdout;
static pthread_t thread_stderr;
static bool stdio_redirected = false;

static void* thread_stdout_func(void*) {
    ssize_t r;
    char buf[2048];
    while ((r = read(pipe_stdout[0], buf, sizeof(buf) - 1)) > 0) {
        if (buf[r - 1] == '\n') --r;
        buf[r] = 0;
        __android_log_write(ANDROID_LOG_INFO, TAG, buf);
    }
    return nullptr;
}

static void* thread_stderr_func(void*) {
    ssize_t r;
    char buf[2048];
    while ((r = read(pipe_stderr[0], buf, sizeof(buf) - 1)) > 0) {
        if (buf[r - 1] == '\n') --r;
        buf[r] = 0;
        __android_log_write(ANDROID_LOG_ERROR, TAG, buf);
    }
    return nullptr;
}

static void redirect_stdio_to_logcat() {
    if (stdio_redirected) return;
    stdio_redirected = true;

    setvbuf(stdout, nullptr, _IONBF, 0);
    pipe(pipe_stdout);
    dup2(pipe_stdout[1], STDOUT_FILENO);

    setvbuf(stderr, nullptr, _IONBF, 0);
    pipe(pipe_stderr);
    dup2(pipe_stderr[1], STDERR_FILENO);

    pthread_create(&thread_stdout, nullptr, thread_stdout_func, nullptr);
    pthread_detach(thread_stdout);

    pthread_create(&thread_stderr, nullptr, thread_stderr_func, nullptr);
    pthread_detach(thread_stderr);
}

extern "C" JNIEXPORT jint JNICALL
Java_com_msamods_androprint_NodeRunner_startNodeWithArguments(
        JNIEnv *env,
        jclass /* clazz */,
        jobjectArray arguments,
        jstring projectDir) {

    // 1. Set current working directory & environment variables to project files folder
    if (projectDir != nullptr) {
        const char *dir = env->GetStringUTFChars(projectDir, nullptr);
        if (dir != nullptr) {
            chdir(dir);
            setenv("HOME", dir, 1);
            setenv("NODE_PATH", dir, 1);
            __android_log_print(ANDROID_LOG_INFO, TAG, "Node environment CWD configured: %s", dir);
            env->ReleaseStringUTFChars(projectDir, dir);
        }
    }

    // 2. Redirect logs to logcat
    redirect_stdio_to_logcat();

    // 3. Prepare arguments
    jsize argument_count = env->GetArrayLength(arguments);

    int c_arguments_size = 0;
    for (int i = 0; i < argument_count; i++) {
        auto str = (jstring) env->GetObjectArrayElement(arguments, i);
        const char *chars = env->GetStringUTFChars(str, nullptr);
        c_arguments_size += strlen(chars) + 1;
        env->ReleaseStringUTFChars(str, chars);
    }

    char *args_buffer = (char *) calloc(c_arguments_size, sizeof(char));
    char **argv = (char **) malloc(argument_count * sizeof(char *));
    char *current_pos = args_buffer;

    for (int i = 0; i < argument_count; i++) {
        auto str = (jstring) env->GetObjectArrayElement(arguments, i);
        const char *chars = env->GetStringUTFChars(str, nullptr);
        strcpy(current_pos, chars);
        argv[i] = current_pos;
        current_pos += strlen(chars) + 1;
        env->ReleaseStringUTFChars(str, chars);
    }

    __android_log_print(ANDROID_LOG_INFO, TAG, "Starting Node.js native engine with %d args...", argument_count);

    int exit_code = node::Start(argument_count, argv);

    __android_log_print(ANDROID_LOG_INFO, TAG, "Node.js native engine finished with exit code: %d", exit_code);

    free(argv);
    free(args_buffer);

    return (jint) exit_code;
}
