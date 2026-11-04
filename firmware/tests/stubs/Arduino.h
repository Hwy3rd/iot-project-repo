#pragma once
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>

// Minimal host adapters; the production queue and ArduinoJson run unchanged.
class String {
 public:
  String(const char* text = "") : value(text) {}
  String(std::string text) : value(text) {}
  size_t length() const { return value.size(); }
  const char* c_str() const { return value.c_str(); }
  int lastIndexOf(char c) const {
    auto position = value.rfind(c);
    return position == std::string::npos ? -1 : static_cast<int>(position);
  }
  String substring(size_t start, size_t end = std::string::npos) const {
    return value.substr(start, end == std::string::npos ? end : end - start);
  }
  bool endsWith(const char* suffix) const {
    size_t length = strlen(suffix);
    return value.size() >= length && value.compare(value.size() - length, length, suffix) == 0;
  }
  friend String operator+(const String& a, const char* b) { return a.value + b; }
 private:
  std::string value;
};

inline size_t strlcpy(char* target, const char* source, size_t length) {
  size_t n = strlen(source);
  if (length) { size_t copied = n < length - 1 ? n : length - 1; memcpy(target, source, copied); target[copied] = 0; }
  return n;
}
extern unsigned long testMillis;
inline unsigned long millis() { return testMillis; }
struct TestSerial {
  void println(const char*) {}
  template <typename... Args> void printf(const char*, Args...) {}
};
static TestSerial Serial;
