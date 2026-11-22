#pragma once
// Kolejki lock-free single-producer / single-consumer.
// Producent i konsument to dokładnie jeden wątek każdy. Bez alokacji po konstrukcji.
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <type_traits>

namespace yoga {

/// Kolejka elementów stałego rozmiaru, pojemność N (potęga 2).
template <typename T, size_t N>
class SpscQueue {
    static_assert((N & (N - 1)) == 0, "N must be a power of two");
    static_assert(std::is_trivially_copyable_v<T>, "T must be trivially copyable");

public:
    bool push(const T& v) {
        const uint64_t head = head_.load(std::memory_order_relaxed);
        if (head - tail_.load(std::memory_order_acquire) >= N) return false;
        buf_[head & (N - 1)] = v;
        head_.store(head + 1, std::memory_order_release);
        return true;
    }

    bool pop(T& out) {
        const uint64_t tail = tail_.load(std::memory_order_relaxed);
        if (tail == head_.load(std::memory_order_acquire)) return false;
        out = buf_[tail & (N - 1)];
        tail_.store(tail + 1, std::memory_order_release);
        return true;
    }

    bool empty() const { return tail_.load(std::memory_order_acquire) == head_.load(std::memory_order_acquire); }

    /// Tylko gdy żaden wątek nie używa kolejki (init/shutdown).
    void reset() {
        head_.store(0, std::memory_order_relaxed);
        tail_.store(0, std::memory_order_relaxed);
    }

private:
    T buf_[N]{};
    alignas(64) std::atomic<uint64_t> head_{0};
    alignas(64) std::atomic<uint64_t> tail_{0};
};

/// Pierścień bajtów na rekordy zmiennej długości: [u32 len][len bajtów].
/// Producent (wątek gry) zapisuje cały rekord albo nic.
template <size_t N>
class SpscByteRing {
    static_assert((N & (N - 1)) == 0, "N must be a power of two");

public:
    static constexpr size_t kCapacity = N;

    /// Rezerwuje miejsce na rekord o długości `len`. Zwraca false, gdy brak miejsca.
    /// Po begin() wołaj write() łącznie dokładnie `len` bajtów, potem commit().
    bool begin(uint32_t len) {
        const uint64_t head = head_.load(std::memory_order_relaxed);
        const uint64_t need = uint64_t{len} + 4;
        if (need > N) return false;
        if (N - (head - tail_.load(std::memory_order_acquire)) < need) return false;
        wpos_ = head;
        put(&len, 4);
        return true;
    }
    void write(const void* p, size_t n) { put(p, n); }
    void commit() { head_.store(wpos_, std::memory_order_release); }

    /// Konsument: długość następnego rekordu albo -1.
    int64_t peek_len() const {
        const uint64_t tail = tail_.load(std::memory_order_relaxed);
        if (tail == head_.load(std::memory_order_acquire)) return -1;
        uint32_t len = 0;
        get(tail, &len, 4);
        return len;
    }
    /// Kopiuje następny rekord do out (rozmiar >= peek_len()) i usuwa go.
    void pop(void* out) {
        const uint64_t tail = tail_.load(std::memory_order_relaxed);
        uint32_t len = 0;
        get(tail, &len, 4);
        get(tail + 4, out, len);
        tail_.store(tail + 4 + len, std::memory_order_release);
    }

    void reset() {
        head_.store(0, std::memory_order_relaxed);
        tail_.store(0, std::memory_order_relaxed);
    }

private:
    void put(const void* p, size_t n) {
        const auto* src = static_cast<const uint8_t*>(p);
        const size_t off = static_cast<size_t>(wpos_ & (N - 1));
        const size_t first = n < N - off ? n : N - off;
        std::memcpy(buf_ + off, src, first);
        std::memcpy(buf_, src + first, n - first);
        wpos_ += n;
    }
    void get(uint64_t pos, void* p, size_t n) const {
        auto* dst = static_cast<uint8_t*>(p);
        const size_t off = static_cast<size_t>(pos & (N - 1));
        const size_t first = n < N - off ? n : N - off;
        std::memcpy(dst, buf_ + off, first);
        std::memcpy(dst + first, buf_, n - first);
    }

    uint8_t buf_[N]{};
    uint64_t wpos_ = 0;  // tylko producent
    alignas(64) std::atomic<uint64_t> head_{0};
    alignas(64) std::atomic<uint64_t> tail_{0};
};

/// Potrójny bufor: pisarz zawsze ma wolny bufor, czytelnik dostaje najnowszy opublikowany.
/// Bez locków, bez retry; stare snapshoty są nadpisywane (brak klienta = nic się nie kolejkuje).
template <typename T>
class TripleBuffer {
    static_assert(std::is_trivially_copyable_v<T>, "T must be trivially copyable");
    static constexpr uint8_t kDirty = 0x4;

public:
    T& back() { return bufs_[back_]; }
    /// Pisarz: publikuje back() i dostaje nowy back().
    void publish() {
        const uint8_t prev = middle_.exchange(static_cast<uint8_t>(back_ | kDirty), std::memory_order_acq_rel);
        back_ = prev & 3;
    }
    /// Czytelnik: true, gdy od ostatniego odczytu opublikowano nowy snapshot; wtedy front() go zawiera.
    bool update() {
        if ((middle_.load(std::memory_order_acquire) & kDirty) == 0) return false;
        const uint8_t prev = middle_.exchange(front_, std::memory_order_acq_rel);
        front_ = prev & 3;
        return true;
    }
    const T& front() const { return bufs_[front_]; }

    void reset() {
        back_ = 0;
        middle_.store(1, std::memory_order_relaxed);
        front_ = 2;
    }

private:
    T bufs_[3]{};
    uint8_t back_ = 0;                     // tylko pisarz
    alignas(64) std::atomic<uint8_t> middle_{1};
    alignas(64) uint8_t front_ = 2;        // tylko czytelnik
};

}  // namespace yoga
