#include <jni.h>
#include <string>
#include <vector>

namespace node {
int Start(int argc, char** argv);
}

extern "C" JNIEXPORT jint JNICALL
Java_com_radiflow_player_EmbeddedNode_runNode(JNIEnv* env, jclass, jobjectArray arguments) {
    const auto count = env->GetArrayLength(arguments);
    std::vector<std::string> strings;
    strings.reserve(count);
    for (jsize index = 0; index < count; ++index) {
        auto argument = static_cast<jstring>(env->GetObjectArrayElement(arguments, index));
        const char* text = env->GetStringUTFChars(argument, nullptr);
        if (!text) return -1;
        strings.emplace_back(text);
        env->ReleaseStringUTFChars(argument, text);
        env->DeleteLocalRef(argument);
    }
    std::vector<char*> argv;
    argv.reserve(count + 1);
    for (auto& text : strings) argv.push_back(text.data());
    argv.push_back(nullptr);
    return node::Start(count, argv.data());
}
