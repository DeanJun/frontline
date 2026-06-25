const Room = require('./Room');

class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomId -> Room
    this.playerRoom = new Map(); // playerId -> roomId
    this.nextRoomId = 1;
  }

  joinRoom(playerId, ws, nickname) {
    // 빈 자리 있는 룸 찾기
    let room = null;
    for (const r of this.rooms.values()) {
      if (!r.isFull()) { room = r; break; }
    }

    // 없으면 새 룸 생성
    if (!room) {
      const roomId = `room_${this.nextRoomId++}`;
      room = new Room(roomId);
      this.rooms.set(roomId, room);
    }

    room.addPlayer(playerId, ws, nickname);
    this.playerRoom.set(playerId, room.id);
    return room;
  }

  leaveRoom(playerId) {
    const roomId = this.playerRoom.get(playerId);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) return;

    room.removePlayer(playerId);
    this.playerRoom.delete(playerId);

    if (room.isEmpty()) {
      this.rooms.delete(roomId);
    }
  }

  getRoom(playerId) {
    const roomId = this.playerRoom.get(playerId);
    return roomId ? this.rooms.get(roomId) : null;
  }
}

module.exports = RoomManager;
