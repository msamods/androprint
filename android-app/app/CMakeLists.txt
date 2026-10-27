cmake_minimum_required(VERSION 3.4.1)

project("androprint")

# Creates and names a library, sets it as SHARED
add_library(
    androprint-native
    SHARED
    src/main/cpp/native-lib.cpp
)

# Includes node headers
include_directories(src/main/cpp/include/node/)

# Import prebuilt libnode.so from jniLibs
add_library(libnode SHARED IMPORTED)
set_target_properties(
    libnode
    PROPERTIES IMPORTED_LOCATION
    ${CMAKE_CURRENT_SOURCE_DIR}/src/main/jniLibs/${ANDROID_ABI}/libnode.so
)

find_library(log-lib log)

target_link_libraries(
    androprint-native
    libnode
    ${log-lib}
)
