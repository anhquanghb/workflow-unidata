import React, { useState, useEffect, useMemo } from 'react';
import { WorkflowInstance, IsoDefinition, UserProfile, GoogleDriveConfig, IsoStep, IsoTransition, IsoRecordForm, Faculty, Unit, HumanResourceRecord } from '../types';
import { Play, CheckCircle, Clock, AlertCircle, FileText, User, ArrowRight, Save, Copy, RefreshCw, MessageSquare } from 'lucide-react';

interface WorkflowModuleProps {
    isoDefinitions: IsoDefinition[];
    currentUser?: UserProfile;
    driveSession: GoogleDriveConfig;
    faculties: Faculty[];
    units: Unit[];
    humanResources: HumanResourceRecord[];
}

const WorkflowModule: React.FC<WorkflowModuleProps> = ({
    isoDefinitions,
    currentUser,
    driveSession,
    faculties,
    units,
    humanResources
}) => {
    const [activeTab, setActiveTab] = useState<'my_tasks' | 'my_requests'>('my_tasks');
    const [instances, setInstances] = useState<WorkflowInstance[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedInstance, setSelectedInstance] = useState<WorkflowInstance | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [selectedProcessId, setSelectedProcessId] = useState<string>('');

    // Fetch instances from Google Drive
    const fetchInstances = async () => {
        if (!driveSession.isConnected || !driveSession.accessToken) return;
        setIsLoading(true);
        try {
            // 1. Find UniData_System folder
            const systemFolderQuery = `name='UniData_System' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
            const systemFolderResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(systemFolderQuery)}`, {
                headers: { 'Authorization': `Bearer ${driveSession.accessToken}` }
            });
            const systemFolderData = await systemFolderResp.json();
            if (!systemFolderData.files || systemFolderData.files.length === 0) {
                setIsLoading(false);
                return;
            }
            const systemFolderId = systemFolderData.files[0].id;

            // 2. Find UniData_Workflows folder inside UniData_System
            const wfFolderQuery = `name='UniData_Workflows' and '${systemFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
            const wfFolderResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(wfFolderQuery)}`, {
                headers: { 'Authorization': `Bearer ${driveSession.accessToken}` }
            });
            const wfFolderData = await wfFolderResp.json();
            
            let wfFolderId = '';
            if (!wfFolderData.files || wfFolderData.files.length === 0) {
                // Create it
                const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${driveSession.accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name: 'UniData_Workflows',
                        mimeType: 'application/vnd.google-apps.folder',
                        parents: [systemFolderId]
                    })
                });
                const createData = await createResp.json();
                wfFolderId = createData.id;
            } else {
                wfFolderId = wfFolderData.files[0].id;
            }

            // 3. List all JSON files in UniData_Workflows
            const filesQuery = `'${wfFolderId}' in parents and mimeType='application/json' and trashed=false`;
            const filesResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(filesQuery)}&fields=files(id,name,modifiedTime)`, {
                headers: { 'Authorization': `Bearer ${driveSession.accessToken}` }
            });
            const filesData = await filesResp.json();

            if (filesData.files) {
                const loadedInstances: WorkflowInstance[] = [];
                for (const file of filesData.files) {
                    const fileResp = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
                        headers: { 'Authorization': `Bearer ${driveSession.accessToken}` }
                    });
                    if (fileResp.ok) {
                        const data = await fileResp.json();
                        loadedInstances.push(data);
                    }
                }
                setInstances(loadedInstances);
            }
        } catch (error) {
            console.error("Error fetching workflow instances:", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchInstances();
    }, [driveSession.isConnected]);

    const saveInstance = async (instance: WorkflowInstance) => {
        if (!driveSession.isConnected || !driveSession.accessToken) {
            alert("Vui lòng kết nối Google Drive để lưu.");
            return;
        }
        try {
            // Find folder
            const systemFolderQuery = `name='UniData_System' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
            const systemFolderResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(systemFolderQuery)}`, {
                headers: { 'Authorization': `Bearer ${driveSession.accessToken}` }
            });
            const systemFolderData = await systemFolderResp.json();
            const systemFolderId = systemFolderData.files[0].id;

            const wfFolderQuery = `name='UniData_Workflows' and '${systemFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
            const wfFolderResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(wfFolderQuery)}`, {
                headers: { 'Authorization': `Bearer ${driveSession.accessToken}` }
            });
            const wfFolderData = await wfFolderResp.json();
            const wfFolderId = wfFolderData.files[0].id;

            const fileName = `wfi_${instance.id}.json`;
            const fileQuery = `name='${fileName}' and '${wfFolderId}' in parents and trashed=false`;
            const fileResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(fileQuery)}`, {
                headers: { 'Authorization': `Bearer ${driveSession.accessToken}` }
            });
            const fileData = await fileResp.json();

            const fileContent = JSON.stringify(instance, null, 2);
            const metadata = {
                name: fileName,
                mimeType: 'application/json',
                parents: fileData.files && fileData.files.length > 0 ? undefined : [wfFolderId]
            };

            const form = new FormData();
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            form.append('file', new Blob([fileContent], { type: 'application/json' }));

            let uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
            let method = 'POST';

            if (fileData.files && fileData.files.length > 0) {
                // Check optimistic locking
                const existingFile = fileData.files[0];
                const existingFileResp = await fetch(`https://www.googleapis.com/drive/v3/files/${existingFile.id}?fields=modifiedTime`, {
                    headers: { 'Authorization': `Bearer ${driveSession.accessToken}` }
                });
                const existingFileData = await existingFileResp.json();
                
                // Simplified check: if existing is newer, reject
                if (new Date(existingFileData.modifiedTime) > new Date(instance.updatedAt)) {
                    alert("Dữ liệu đã bị thay đổi bởi người khác. Vui lòng làm mới trang.");
                    return;
                }

                uploadUrl = `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=multipart`;
                method = 'PATCH';
                form.delete('metadata');
                form.append('metadata', new Blob([JSON.stringify({mimeType: 'application/json'})], { type: 'application/json' }));
            }

            instance.updatedAt = new Date().toISOString(); // Update timestamp before save
            form.set('file', new Blob([JSON.stringify(instance, null, 2)], { type: 'application/json' }));

            const uploadResp = await fetch(uploadUrl, {
                method: method,
                headers: { 'Authorization': `Bearer ${driveSession.accessToken}` },
                body: form
            });

            if (uploadResp.ok) {
                setInstances(prev => {
                    const exists = prev.find(i => i.id === instance.id);
                    if (exists) return prev.map(i => i.id === instance.id ? instance : i);
                    return [...prev, instance];
                });
                setSelectedInstance(instance);
                alert("Đã lưu thành công!");
            } else {
                alert("Lỗi khi lưu lên Drive.");
            }
        } catch (error) {
            console.error("Save error:", error);
            alert("Lỗi khi lưu.");
        }
    };

    const handleCreateNew = () => {
        if (!selectedProcessId) {
            alert("Vui lòng chọn một quy trình.");
            return;
        }
        const processDef = isoDefinitions.find(d => d.id === selectedProcessId);
        if (!processDef || !processDef.processData) return;

        // Find start node
        const startNode = processDef.processData.flowchart.nodes.find(n => n.type === 'start');
        if (!startNode) {
            alert("Quy trình không có điểm bắt đầu hợp lệ.");
            return;
        }

        const newInstance: WorkflowInstance = {
            id: crypto.randomUUID(),
            processId: selectedProcessId,
            currentStepId: startNode.id,
            status: 'Pending',
            payload: {},
            auditLogs: [{
                id: crypto.randomUUID(),
                userId: currentUser?.id || 'unknown',
                action: 'Khởi tạo quy trình',
                stepId: startNode.id,
                timestamp: new Date().toISOString()
            }],
            creatorId: currentUser?.id || 'unknown',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        saveInstance(newInstance);
        setIsCreating(false);
    };

    const handleTransition = (transition: IsoTransition) => {
        if (!selectedInstance || !currentUser) return;

        const updatedInstance = { ...selectedInstance };
        updatedInstance.currentStepId = transition.toStepId;
        
        // Check if end node
        const processDef = isoDefinitions.find(d => d.id === selectedInstance.processId);
        const nextNode = processDef?.processData?.flowchart.nodes.find(n => n.id === transition.toStepId);
        
        if (nextNode?.type === 'end') {
            updatedInstance.status = 'Completed';
        } else {
            updatedInstance.status = 'In Progress';
        }

        updatedInstance.auditLogs.push({
            id: crypto.randomUUID(),
            userId: currentUser.id,
            action: transition.actionName,
            stepId: selectedInstance.currentStepId,
            timestamp: new Date().toISOString()
        });

        saveInstance(updatedInstance);
    };

    const handleGeneratePrompt = () => {
        if (!selectedInstance) return;
        const processDef = isoDefinitions.find(d => d.id === selectedInstance.processId);
        if (!processDef || !processDef.processData) return;

        const currentStep = processDef.processData.stepDetails[selectedInstance.currentStepId];
        const transitions = processDef.processData.flowchart.edges.filter(e => e.source === selectedInstance.currentStepId);

        const prompt = `
**Hệ quy chiếu:** Bạn là Chuyên gia Kiểm toán & Trợ lý Quy trình ISO nội bộ của UniData.
**Quy tắc:** Đánh giá tính hợp lệ của dữ liệu dựa trên ngữ cảnh được cung cấp. Không tự suy diễn. Trả lời văn phong hành chính, súc tích.

### 1. Thông tin Quy trình
- Tên quy trình: ${processDef.name}
- Mục đích: ${processDef.processData.purposeScope.purpose}
- Phạm vi: ${processDef.processData.purposeScope.scope}

### 2. Thông tin Bước hiện tại
- Tên bước: ${processDef.processData.flowchart.nodes.find(n => n.id === selectedInstance.currentStepId)?.label}
- Vai trò phụ trách: ${currentStep?.executorRole || 'Không xác định'}
- Hướng dẫn thực thi:
  - Ai làm: ${currentStep?.who || ''}
  - Làm gì: ${currentStep?.what || ''}
  - Khi nào: ${currentStep?.when?.value} ${currentStep?.when?.unit}
  - Như thế nào: ${currentStep?.how || ''}

### 3. Dữ liệu Thu thập (Payload)
\`\`\`json
${JSON.stringify(selectedInstance.payload, null, 2)}
\`\`\`

### 4. Các hướng rẽ (Transitions)
${transitions.map(t => `- ${t.label || 'Chuyển tiếp'} (Tới: ${processDef.processData?.flowchart.nodes.find(n => n.id === t.target)?.label})`).join('\n')}

### Nhiệm vụ của AI:
Vui lòng rà soát Payload so với Hướng dẫn thực thi. Chỉ ra các điểm thiếu sót (nếu có), và tư vấn tôi nên chọn Transition nào tiếp theo.
        `;

        navigator.clipboard.writeText(prompt);
        alert("Đã copy Prompt AI vào Clipboard. Hãy dán vào Google AI Studio.");
    };

    // Filter instances
    const myTasks = useMemo(() => {
        return instances.filter(inst => {
            if (inst.status === 'Completed' || inst.status === 'Rejected') return false;
            const processDef = isoDefinitions.find(d => d.id === inst.processId);
            if (!processDef || !processDef.processData) return false;
            const currentStepDetail = processDef.processData.stepDetails[inst.currentStepId];
            // Check if currentUser role matches executorRole
            // In a real app, this might be more complex (matching specific user ID or unit)
            return currentStepDetail?.executorRole === currentUser?.role || currentUser?.role === 'school_admin';
        });
    }, [instances, currentUser, isoDefinitions]);

    const myRequests = useMemo(() => {
        return instances.filter(inst => inst.creatorId === currentUser?.id);
    }, [instances, currentUser]);

    const activeInstances = activeTab === 'my_tasks' ? myTasks : myRequests;

    return (
        <div className="p-6 h-full flex flex-col bg-slate-50">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Thực thi Quy trình</h2>
                    <p className="text-slate-500">Quản lý và xử lý các luồng công việc theo chuẩn ISO.</p>
                </div>
                <div className="flex gap-2">
                    <button 
                        onClick={fetchInstances}
                        className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 shadow-sm transition-all"
                    >
                        <RefreshCw size={18} className={isLoading ? "animate-spin" : ""} /> Làm mới
                    </button>
                    <button 
                        onClick={() => setIsCreating(true)}
                        className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 shadow-sm transition-all"
                    >
                        <Play size={18} /> Khởi tạo Quy trình
                    </button>
                </div>
            </div>

            {isCreating && (
                <div className="mb-6 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <h3 className="text-lg font-bold mb-4">Khởi tạo Quy trình Mới</h3>
                    <div className="flex gap-4">
                        <select 
                            className="flex-1 p-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
                            value={selectedProcessId}
                            onChange={(e) => setSelectedProcessId(e.target.value)}
                        >
                            <option value="">-- Chọn Quy trình --</option>
                            {isoDefinitions.filter(d => d.status === 'đã ban hành').map(def => (
                                <option key={def.id} value={def.id}>[{def.code}] {def.name} (v{def.version})</option>
                            ))}
                        </select>
                        <button 
                            onClick={handleCreateNew}
                            className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition-colors"
                        >
                            Bắt đầu
                        </button>
                        <button 
                            onClick={() => setIsCreating(false)}
                            className="bg-slate-200 text-slate-700 px-6 py-2 rounded-lg hover:bg-slate-300 transition-colors"
                        >
                            Hủy
                        </button>
                    </div>
                </div>
            )}

            {!selectedInstance ? (
                <div className="flex-1 flex flex-col min-h-0">
                    <div className="flex gap-4 mb-6 border-b border-slate-200">
                        <button 
                            className={`pb-3 px-2 font-medium text-sm transition-colors relative ${activeTab === 'my_tasks' ? 'text-blue-600' : 'text-slate-500 hover:text-slate-800'}`}
                            onClick={() => setActiveTab('my_tasks')}
                        >
                            Việc của tôi
                            {activeTab === 'my_tasks' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t-full" />}
                        </button>
                        <button 
                            className={`pb-3 px-2 font-medium text-sm transition-colors relative ${activeTab === 'my_requests' ? 'text-blue-600' : 'text-slate-500 hover:text-slate-800'}`}
                            onClick={() => setActiveTab('my_requests')}
                        >
                            Quy trình tôi đã tạo
                            {activeTab === 'my_requests' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t-full" />}
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {isLoading ? (
                            <div className="flex justify-center items-center h-32 text-slate-500">Đang tải dữ liệu...</div>
                        ) : activeInstances.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-64 text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                                <CheckCircle size={48} className="mb-4 opacity-20" />
                                <p className="text-lg font-medium">Không có công việc nào</p>
                            </div>
                        ) : (
                            <div className="grid gap-4">
                                {activeInstances.map(inst => {
                                    const processDef = isoDefinitions.find(d => d.id === inst.processId);
                                    const currentNode = processDef?.processData?.flowchart.nodes.find(n => n.id === inst.currentStepId);
                                    
                                    return (
                                        <div 
                                            key={inst.id} 
                                            className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-all cursor-pointer flex items-center justify-between"
                                            onClick={() => setSelectedInstance(inst)}
                                        >
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded uppercase">
                                                        {processDef?.code || 'UNKNOWN'}
                                                    </span>
                                                    <span className={`text-xs font-bold px-2 py-0.5 rounded uppercase ${
                                                        inst.status === 'Completed' ? 'bg-green-100 text-green-700' :
                                                        inst.status === 'In Progress' ? 'bg-blue-100 text-blue-700' :
                                                        'bg-amber-100 text-amber-700'
                                                    }`}>
                                                        {inst.status}
                                                    </span>
                                                </div>
                                                <h4 className="font-bold text-slate-800">{processDef?.name || 'Quy trình không xác định'}</h4>
                                                <p className="text-sm text-slate-500 mt-1 flex items-center gap-1">
                                                    <ArrowRight size={14} /> Bước hiện tại: <span className="font-medium text-slate-700">{currentNode?.label || 'Hoàn thành'}</span>
                                                </p>
                                            </div>
                                            <div className="text-right text-sm text-slate-500">
                                                <div>Cập nhật: {new Date(inst.updatedAt).toLocaleString()}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex flex-col min-h-0 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    {/* Task Detail View */}
                    <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                        <div>
                            <button 
                                onClick={() => setSelectedInstance(null)}
                                className="text-sm text-blue-600 hover:underline mb-1 inline-block"
                            >
                                &larr; Quay lại danh sách
                            </button>
                            <h3 className="text-xl font-bold text-slate-800">
                                {isoDefinitions.find(d => d.id === selectedInstance.processId)?.name}
                            </h3>
                        </div>
                        <div className="flex gap-2">
                            <button 
                                onClick={handleGeneratePrompt}
                                className="flex items-center gap-2 bg-purple-100 text-purple-700 px-3 py-1.5 rounded-lg hover:bg-purple-200 transition-colors text-sm font-medium"
                            >
                                <MessageSquare size={16} /> Hỏi Trợ lý AI
                            </button>
                            <button 
                                onClick={() => saveInstance(selectedInstance)}
                                className="flex items-center gap-2 bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                            >
                                <Save size={16} /> Lưu nháp
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 flex gap-6">
                        {/* Left: Form & Actions */}
                        <div className="flex-[2] space-y-6">
                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                                <h4 className="font-bold text-slate-800 mb-4">Dữ liệu biểu mẫu (Payload)</h4>
                                <textarea 
                                    className="w-full h-64 p-3 font-mono text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
                                    value={JSON.stringify(selectedInstance.payload, null, 2)}
                                    onChange={(e) => {
                                        try {
                                            const parsed = JSON.parse(e.target.value);
                                            setSelectedInstance({...selectedInstance, payload: parsed});
                                        } catch (err) {
                                            // Handle invalid JSON gracefully if needed
                                        }
                                    }}
                                    placeholder="Nhập dữ liệu JSON..."
                                />
                                <p className="text-xs text-slate-500 mt-2">* Trong thực tế, phần này sẽ tự động render thành các Form Input dựa trên cấu hình IsoRecordForm.</p>
                            </div>

                            {/* Transitions */}
                            {selectedInstance.status !== 'Completed' && (
                                <div>
                                    <h4 className="font-bold text-slate-800 mb-3">Hành động tiếp theo</h4>
                                    <div className="flex flex-wrap gap-3">
                                        {isoDefinitions.find(d => d.id === selectedInstance.processId)?.processData?.flowchart.edges
                                            .filter(e => e.source === selectedInstance.currentStepId)
                                            .map(edge => (
                                                <button
                                                    key={edge.id}
                                                    onClick={() => handleTransition({
                                                        id: edge.id,
                                                        fromStepId: edge.source,
                                                        toStepId: edge.target,
                                                        actionName: edge.label || 'Chuyển tiếp',
                                                        condition: ''
                                                    })}
                                                    className="bg-white border-2 border-blue-500 text-blue-600 px-4 py-2 rounded-lg hover:bg-blue-50 font-medium transition-colors"
                                                >
                                                    {edge.label || 'Chuyển tiếp'}
                                                </button>
                                            ))
                                        }
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Right: Context & Audit Log */}
                        <div className="flex-1 space-y-6">
                            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                                <h4 className="font-bold text-blue-800 mb-2 flex items-center gap-2">
                                    <AlertCircle size={16} /> Hướng dẫn thực thi
                                </h4>
                                {(() => {
                                    const processDef = isoDefinitions.find(d => d.id === selectedInstance.processId);
                                    const stepDetail = processDef?.processData?.stepDetails[selectedInstance.currentStepId];
                                    if (!stepDetail) return <p className="text-sm text-blue-600">Không có hướng dẫn chi tiết cho bước này.</p>;
                                    return (
                                        <div className="text-sm text-blue-900 space-y-2">
                                            <p><strong>Ai làm:</strong> {stepDetail.who}</p>
                                            <p><strong>Làm gì:</strong> {stepDetail.what}</p>
                                            <p><strong>Khi nào:</strong> {stepDetail.when.value} {stepDetail.when.unit}</p>
                                            <p><strong>Như thế nào:</strong> {stepDetail.how}</p>
                                        </div>
                                    );
                                })()}
                            </div>

                            <div>
                                <h4 className="font-bold text-slate-800 mb-3">Nhật ký kiểm toán (Audit Log)</h4>
                                <div className="space-y-3 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-300 before:to-transparent">
                                    {selectedInstance.auditLogs.map((log, idx) => (
                                        <div key={log.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                                            <div className="flex items-center justify-center w-4 h-4 rounded-full border border-white bg-slate-300 group-[.is-active]:bg-blue-500 text-slate-500 group-[.is-active]:text-blue-50 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2"></div>
                                            <div className="w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] bg-white p-3 rounded border border-slate-200 shadow-sm">
                                                <div className="flex items-center justify-between mb-1">
                                                    <div className="font-bold text-slate-800 text-xs">{log.action}</div>
                                                    <div className="text-[10px] text-slate-500">{new Date(log.timestamp).toLocaleTimeString()}</div>
                                                </div>
                                                <div className="text-xs text-slate-600">User: {log.userId}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkflowModule;
