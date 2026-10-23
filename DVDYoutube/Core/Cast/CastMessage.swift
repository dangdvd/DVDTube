import Foundation

/// The Cast v2 wire format: every message is a length-prefixed protobuf
///
///     message CastMessage {
///       required ProtocolVersion protocol_version = 1;  // CASTV2_1_0 = 0
///       required string source_id = 2;
///       required string destination_id = 3;
///       required string namespace = 4;
///       required PayloadType payload_type = 5;          // STRING = 0
///       optional string payload_utf8 = 6;
///       optional bytes payload_binary = 7;
///     }
///
/// sent over TLS to port 8009 of the device. Only string (JSON) payloads are used.
struct CastMessage {
    var source: String
    var destination: String
    var namespace: String
    var payload: String

    enum Namespace {
        static let connection = "urn:x-cast:com.google.cast.tp.connection"
        static let heartbeat = "urn:x-cast:com.google.cast.tp.heartbeat"
        static let receiver = "urn:x-cast:com.google.cast.receiver"
        static let media = "urn:x-cast:com.google.cast.media"
    }

    /// The message with its 4-byte big-endian length prefix.
    var framed: Data {
        var body = Data()
        Self.appendVarint(1 << 3, to: &body)
        Self.appendVarint(0, to: &body)
        Self.appendString(source, field: 2, to: &body)
        Self.appendString(destination, field: 3, to: &body)
        Self.appendString(namespace, field: 4, to: &body)
        Self.appendVarint(5 << 3, to: &body)
        Self.appendVarint(0, to: &body)
        Self.appendString(payload, field: 6, to: &body)

        let length = UInt32(body.count)
        var frame = Data([UInt8(length >> 24 & 0xFF), UInt8(length >> 16 & 0xFF), UInt8(length >> 8 & 0xFF), UInt8(length & 0xFF)])
        frame.append(body)
        return frame
    }

    static func decode(_ data: Data) -> CastMessage? {
        let bytes = [UInt8](data)
        var index = 0
        var message = CastMessage(source: "", destination: "", namespace: "", payload: "")
        while index < bytes.count {
            guard let key = readVarint(bytes, &index) else { return nil }
            let field = key >> 3
            switch key & 0x7 {
            case 0:
                guard readVarint(bytes, &index) != nil else { return nil }
            case 1:
                index += 8
            case 2:
                guard let length = readVarint(bytes, &index), index + Int(length) <= bytes.count else { return nil }
                let value = String(decoding: bytes[index..<index + Int(length)], as: UTF8.self)
                index += Int(length)
                switch field {
                case 2: message.source = value
                case 3: message.destination = value
                case 4: message.namespace = value
                case 6: message.payload = value
                default: break
                }
            case 5:
                index += 4
            default:
                return nil
            }
        }
        return message
    }

    private static func appendString(_ value: String, field: UInt64, to data: inout Data) {
        let utf8 = Data(value.utf8)
        appendVarint(field << 3 | 2, to: &data)
        appendVarint(UInt64(utf8.count), to: &data)
        data.append(utf8)
    }

    private static func appendVarint(_ value: UInt64, to data: inout Data) {
        var value = value
        repeat {
            var byte = UInt8(value & 0x7F)
            value >>= 7
            if value != 0 { byte |= 0x80 }
            data.append(byte)
        } while value != 0
    }

    private static func readVarint(_ bytes: [UInt8], _ index: inout Int) -> UInt64? {
        var result: UInt64 = 0
        var shift: UInt64 = 0
        while index < bytes.count, shift < 64 {
            let byte = bytes[index]
            index += 1
            result |= UInt64(byte & 0x7F) << shift
            if byte & 0x80 == 0 { return result }
            shift += 7
        }
        return nil
    }
}
